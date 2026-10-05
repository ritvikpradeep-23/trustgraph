// Accumulates the messages of the open chat while the TrustGraph panel is
// open. Chat lists are virtualised (WhatsApp keeps ~16 messages in the DOM),
// so we keep everything we've seen in a Map keyed by message id: scrolling
// ADDS to it, never replaces it.
//
//   const store = new TrustGraphChatStore(adapter, {onChange, debug});
//   store.start();          // read now + watch for new rows (debounced 250ms)
//   store.messages();       // records in conversation order
//   store.scanEarlier();    // user-requested: scroll up in steps, then restore
//   store.stop();           // stop watching and forget all text
//
// Privacy: records (including text) live only in this object, in memory.
// Nothing is written to chrome.storage or logged. stop() and a chat switch
// clear it.
(function (root) {
  "use strict";

  const DEBOUNCE_MS = 250;

  class ChatStore {
    constructor(adapter, opts = {}) {
      this.adapter = adapter;
      this.onChange = opts.onChange || (() => {});
      this.debug = !!opts.debug;
      this.map = new Map(); // id -> record
      this.order = []; // ids in conversation order
      this.chatKey = null;
      this.observer = null;
      this.observed = null;
      this.timer = 0;
      this.lastStats = null;
      this.scanning = false;
    }

    start() {
      this.chatKey = this.adapter.chatKey ? this.adapter.chatKey() : location.href;
      this.readNow();
      this.watch();
    }

    stop() {
      if (this.observer) this.observer.disconnect();
      this.observer = null;
      this.observed = null;
      clearTimeout(this.timer);
      this.reset();
    }

    reset() {
      this.map.clear();
      this.order = [];
    }

    // Watch the message list for rows added by scrolling or new messages.
    watch() {
      const target = (this.adapter.scroller && this.adapter.scroller()) || (this.adapter.messagePane && this.adapter.messagePane()) || document.body;
      if (target === this.observed) return;
      if (this.observer) this.observer.disconnect();
      this.observed = target;
      this.observer = new MutationObserver(() => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.refresh(), DEBOUNCE_MS);
      });
      this.observer.observe(target, { childList: true, subtree: true, characterData: true });
    }

    // Called on mutations and by the content script's 1s tick.
    refresh() {
      const key = this.adapter.chatKey ? this.adapter.chatKey() : location.href;
      if (key !== this.chatKey) {
        // A different chat: start over so two chats never mix.
        this.chatKey = key;
        this.reset();
        this.observed = null;
        this.watch();
        this.readNow({ chatSwitched: true });
        return;
      }
      if (!this.observed || !this.observed.isConnected) this.watch();
      this.readNow();
    }

    readNow(info = {}) {
      const result = this.adapter.read ? this.adapter.read() : { messages: this.adapter.readMessages(), stats: null };
      const added = this.merge(result.messages);
      this.lastStats = result.stats;
      if (this.debug && result.stats) {
        const s = result.stats;
        // Counts only, never message text.
        console.debug(
          "[TrustGraph] read:",
          `rows in DOM ${s.rows}, message containers ${s.containers}, parsed ${s.parsed},`,
          "skipped", JSON.stringify(s.skipped), "| kept", this.map.size, "| new", added
        );
      }
      if (added || info.chatSwitched) this.onChange({ added, chatSwitched: !!info.chatSwitched });
      return added;
    }

    // Merge a fresh read into the stored order. New records are placed next
    // to a neighbour we already know from the same read, so scrolling up
    // (older messages) and down (newer) both land in the right place.
    merge(records) {
      let added = 0;
      const ids = records.map((r) => r.id);
      records.forEach((rec, i) => {
        const existing = this.map.get(rec.id);
        if (existing) {
          Object.assign(existing, rec); // e.g. "Read more" expanded the text
          return;
        }
        this.map.set(rec.id, rec);
        added++;
        // Find the nearest earlier record from this read that we already had.
        let pos = -1;
        for (let j = i - 1; j >= 0; j--) {
          const at = this.order.indexOf(ids[j]);
          if (at !== -1) {
            pos = at + 1;
            break;
          }
        }
        if (pos === -1) {
          // Otherwise go just before the nearest later known one.
          for (let j = i + 1; j < ids.length; j++) {
            const at = this.order.indexOf(ids[j]);
            if (at !== -1) {
              pos = at;
              break;
            }
          }
        }
        if (pos === -1) this.order.push(rec.id);
        else this.order.splice(pos, 0, rec.id);
      });
      return added;
    }

    messages() {
      return this.order.map((id) => this.map.get(id));
    }

    // Real messages (not date separators or system notices).
    readCount() {
      return this.messages().filter((m) => m.type === "text" || m.type === "media" || m.type === "deleted").length;
    }

    elementFor(id) {
      const rec = this.map.get(id);
      if (rec && rec.element && rec.element.isConnected) return rec.element;
      return this.adapter.elementFor ? this.adapter.elementFor(id) : null;
    }

    // "Scan earlier messages": only ever runs because the user asked.
    // Scrolls up in steps, waits for older rows to render, stops at a limit
    // or the top, then puts the scroll position back where the user had it.
    async scanEarlier({ maxSteps = 10, maxMessages = 200, signal, onProgress } = {}) {
      const scroller = this.adapter.scroller && this.adapter.scroller();
      if (!scroller || this.scanning) return { added: 0, reachedTop: false };
      this.scanning = true;
      // Older rows get inserted above, so remember the distance from the
      // bottom rather than scrollTop.
      const fromBottom = scroller.scrollHeight - scroller.scrollTop;
      let added = 0;
      let reachedTop = false;
      let quietAtTop = 0;
      // Virtualised lists (WhatsApp) re-render rows as you scroll; static
      // ones (Gmail, most pages) never do. Only wait patiently for slow
      // renders once the list has shown it re-renders.
      let rerenders = false;
      try {
        for (let step = 0; step < maxSteps && added < maxMessages; step++) {
          if (signal && signal.aborted) break;
          const before = this.map.size;
          const topBefore = scroller.scrollTop;
          scroller.scrollTop = Math.max(0, scroller.scrollTop - scroller.clientHeight * 0.8);
          // Wait for the list to re-render. If nothing changed yet (a slow
          // render), wait again rather than scrolling on and skipping rows.
          let changed = await waitForRows(scroller, rerenders ? 700 : step === 0 ? 900 : 300);
          for (let retry = 0; rerenders && !changed && retry < 2 && scroller.scrollTop !== topBefore; retry++) {
            changed = await waitForRows(scroller, 700);
          }
          if (changed) rerenders = true;
          this.readNow();
          added += this.map.size - before;
          if (onProgress) onProgress({ step: step + 1, added });
          // At the top, the app may still be fetching older messages, so
          // only give up after two quiet rounds there.
          if (topBefore === 0 && this.map.size === before) {
            if (++quietAtTop >= 2) {
              reachedTop = true;
              break;
            }
          } else quietAtTop = 0;
        }
      } finally {
        scroller.scrollTop = scroller.scrollHeight - fromBottom;
        this.scanning = false;
      }
      return { added, reachedTop };
    }
  }

  // Resolves after the next batch of row changes settles (true), or after
  // `ms` with no change (false).
  function waitForRows(node, ms) {
    return new Promise((resolve) => {
      let settle = 0;
      let changed = false;
      const obs = new MutationObserver(() => {
        changed = true;
        clearTimeout(settle);
        settle = setTimeout(done, 150);
      });
      const timeout = setTimeout(done, ms);
      function done() {
        obs.disconnect();
        clearTimeout(timeout);
        clearTimeout(settle);
        resolve(changed);
      }
      obs.observe(node, { childList: true, subtree: true });
    });
  }

  root.TrustGraphChatStore = ChatStore;
})(globalThis);
