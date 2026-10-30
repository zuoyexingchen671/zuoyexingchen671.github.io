/* 手机以横向分栏作为分页，不复制表单节点，输入、按钮及原件链接保持有效。 */
(() => {
  const compact = matchMedia('(max-width: 800px)');
  const decks = new Map();
  let scheduled = false;
  function refresh() {
    scheduled = false;
    for (const view of document.querySelectorAll('.view')) {
      if (view.id === 'document-view' || view.id === 'pair-view') continue;
      let deck = decks.get(view);
      if (!compact.matches) {
        if (deck) {
          deck.reader.before(...deck.reader.childNodes);
          deck.reader.remove();
          deck.footer.remove();
          decks.delete(view);
        }
        continue;
      }
      if (!deck) {
        const reader = document.createElement('div');
        reader.className = 'screen-pages';
        const footer = document.createElement('div');
        footer.className = 'screen-pager';
        const prev = document.createElement('button');
        prev.type = 'button';
        prev.textContent = '上一页';
        const next = document.createElement('button');
        next.type = 'button';
        next.textContent = '下一页';
        const label = document.createElement('span');
        label.setAttribute('aria-live', 'polite');
        footer.append(prev, label, next);
        reader.append(...view.childNodes);
        view.append(reader, footer);
        deck = { reader, footer, prev, next, label, page: 0, count: 1 };
        decks.set(view, deck);
        prev.onclick = () => move(deck, deck.page - 1);
        next.onclick = () => move(deck, deck.page + 1);
        reader.addEventListener('scroll', () => {
          deck.page = Math.round(reader.scrollLeft / (reader.clientWidth + 24));
          update(deck);
        });
      }
      for (const child of [...view.childNodes]) {
        if (child !== deck.reader && child !== deck.footer) deck.reader.append(child);
      }
      if (view.hidden) continue;
      deck.count = Math.max(
        1,
        Math.round((deck.reader.scrollWidth + 24) / (deck.reader.clientWidth + 24))
      );
      move(deck, Math.min(deck.page, deck.count - 1));
    }
  }
  function update(d) {
    const text = `${d.page + 1} / ${d.count}`;
    if (d.label.textContent !== text) d.label.textContent = text;
    d.prev.disabled = d.page <= 0;
    d.next.disabled = d.page >= d.count - 1;
    d.footer.classList.toggle('single-page', d.count === 1);
  }
  function move(d, page) {
    d.page = Math.max(0, Math.min(page, d.count - 1));
    d.reader.scrollTo({
      left: d.page * (d.reader.clientWidth + 24),
      behavior: 'instant',
    });
    update(d);
  }
  function schedule() {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(refresh);
    }
  }
  new MutationObserver((records) => {
    if (records.every((r) => r.target.closest?.('.screen-pager'))) return;
    schedule();
  }).observe(document.querySelector('main'), {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden', 'open'],
  });
  addEventListener('resize', schedule);
  addEventListener('hashchange', () => {
    for (const d of decks.values()) d.page = 0;
    schedule();
  });
  document.addEventListener('toggle', schedule, true);
  document.addEventListener('input', schedule);
  schedule();
})();
