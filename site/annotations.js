import {esc, date, icon, markdown} from './render.js';
import {blockText, selectionAnchor, anchorForBlock, rangeForAnchor} from './annotation-anchor.js';

// The controller lives only for this rendered article. No reading drafts or
// private text are written to browser storage.
export function initAnnotations({root, post, comments = [], me, member, onSubmit, onHide, onEdit, notify = () => {}}) {
  if (!root || !me || post.kind === 'note') return {destroy() {}, open() {}, isBusy: () => false};
  let all = comments, destroyed = false, mode = false, candidate = null, selectionTimer;
  let view = {kind: 'list', blockId: null}, returnFocus = null, pendingHide = null, busy = false;
  let rangeEntries = [], decorations = [], activeRanges = [], fallbackFrame = null;
  const drafts = new Map(), listeners = [], highlightKey = 'community-annotations', activeKey = 'community-annotation-active';
  const canHighlight = !!globalThis.CSS?.highlights && typeof globalThis.Highlight === 'function';
  const drawer = document.createElement('dialog');
  drawer.className = 'annotation-drawer';
  drawer.setAttribute('aria-labelledby', 'annotation-heading');
  const selectionButton = document.createElement('button');
  selectionButton.type = 'button';
  selectionButton.className = 'annotation-selection';
  selectionButton.setAttribute('aria-label', '为选中文字写批注');
  selectionButton.innerHTML = `${icon('pen')}写批注`;
  selectionButton.hidden = true;
  document.body.append(drawer, selectionButton);
  const modeButton = document.createElement('button');
  modeButton.type = 'button'; modeButton.className = 'annotation-mode-done'; modeButton.textContent = '取消选段'; modeButton.hidden = true; document.body.append(modeButton);
  const originalTabIndex = root.getAttribute('tabindex');
  root.tabIndex = -1;
  root.classList.toggle('annotation-fallback', !canHighlight);
  const fallbackLayer = document.createElement('span');
  fallbackLayer.className = 'annotation-rect-layer'; fallbackLayer.dataset.annotationIgnore = ''; fallbackLayer.setAttribute('aria-hidden', 'true');
  if (!canHighlight) root.append(fallbackLayer);
  const blocks = [...root.querySelectorAll('[data-annotation-block]')];
  const listen = (target, type, fn, options) => { target.addEventListener(type, fn, options); listeners.push(() => target.removeEventListener(type, fn, options)); };
  const roots = () => all.filter(c => c.anchor && (!c.replyTo || c.threadId === c.id));
  const thread = id => all.filter(c => c.id === id || c.threadId === id);
  const byId = id => all.find(c => c.id === id);
  const person = id => member(id) || {name: '成员', initial: '同', color: 'sage'};
  const draftKey = () => view.kind === 'edit' ? `edit:${view.editId}` : view.kind === 'new' ? `new:${view.anchor.blockId}:${view.anchor.start}:${view.anchor.end}` : view.kind === 'thread' ? `thread:${view.id}` : null;
  const draft = () => drafts.get(draftKey()) || {body: '', replyTo: null};
  function saveDraft() {
    const field = drawer.querySelector('[name="annotation-body"]'), key = draftKey();
    if (field && key) drafts.set(key, {...draft(), body: field.value});
  }
  function setBusy(value) {
    busy = value;
    drawer.setAttribute('aria-busy', String(value));
    drawer.querySelectorAll('button, textarea').forEach(control => {
      if (value) { control.dataset.annotationWasDisabled = control.disabled ? '1' : '0'; control.disabled = true; }
      else if ('annotationWasDisabled' in control.dataset) { control.disabled = control.dataset.annotationWasDisabled === '1'; delete control.dataset.annotationWasDisabled; }
    });
  }
  function editedLabel(c) {
    if (Number(c.revision || 1) <= 1) return '';
    const changed = new Date(c.updatedAt);
    const stamp = c.updatedAt && Number.isFinite(changed.getTime()) ? new Intl.DateTimeFormat('zh-CN', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai'}).format(changed) : '';
    return `<span class="annotation-edited"${stamp ? ` title="${esc('编辑于 ' + stamp)}"` : ''}>已编辑</span>`;
  }
  function clearSelection() {
    candidate = null;
    selectionButton.hidden = true;
    clearTimeout(selectionTimer);
  }
  function fallbackPaint() {
    if (destroyed || canHighlight) return;
    fallbackLayer.replaceChildren();
    const bounds = root.getBoundingClientRect();
    const draw = (ranges, active) => {
      // A range containing KaTeX exposes both its outer box and descendant
      // glyph boxes. Keep the outer rectangles once; never alter those nodes.
      const rects = ranges.flatMap(range => [...range.getClientRects()]).filter(r => r.width > 0 && r.height > 0)
        .sort((a, b) => b.width * b.height - a.width * a.height);
      const kept = [];
      for (const rect of rects) {
        if (kept.some(r => rect.left >= r.left - .5 && rect.right <= r.right + .5 && rect.top >= r.top - .5 && rect.bottom <= r.bottom + .5)) continue;
        kept.push(rect);
        const left = Math.max(bounds.left, rect.left), right = Math.min(bounds.right, rect.right);
        if (right <= left) continue;
        const mark = document.createElement('span');
        mark.className = active ? 'annotation-range-active' : 'annotation-range-line';
        mark.style.left = `${left - bounds.left}px`;
        mark.style.top = `${(active ? rect.top : rect.bottom + 1) - bounds.top}px`;
        mark.style.width = `${right - left}px`;
        if (active) mark.style.height = `${rect.height}px`;
        fallbackLayer.append(mark);
      }
    };
    draw(rangeEntries.map(entry => entry.range), false);
    draw(activeRanges, true);
  }
  function scheduleFallback() {
    if (canHighlight || destroyed || fallbackFrame !== null) return;
    fallbackFrame = requestAnimationFrame(() => { fallbackFrame = null; fallbackPaint(); });
  }
  function rangesPaint() {
    if (!canHighlight) { fallbackPaint(); return; }
    if (rangeEntries.length) CSS.highlights.set(highlightKey, new Highlight(...rangeEntries.map(x => x.range)));
    else CSS.highlights.delete(highlightKey);
    if (activeRanges.length) CSS.highlights.set(activeKey, new Highlight(...activeRanges));
    else CSS.highlights.delete(activeKey);
  }
  function activePaint(anchor) {
    activeRanges = [];
    if (anchor) { const range = rangeForAnchor(root, anchor); if (range) activeRanges.push(range); }
    rangesPaint();
  }
  function paint() {
    const total = roots().length;
    document.querySelectorAll('[data-annotation-open]').forEach(button => { button.innerHTML = `${icon('pen')}批注${total ? ` ${total}` : ''}`; });
    decorations.forEach(el => el.remove()); decorations = [];
    root.querySelectorAll('.annotation-has-thread').forEach(el => el.classList.remove('annotation-has-thread'));
    rangeEntries = roots().map(c => ({comment: c, range: rangeForAnchor(root, c.anchor)})).filter(x => x.range);
    for (const block of blocks) {
      const related = roots().filter(c => c.anchor.blockId === block.dataset.annotationBlock && rangeEntries.some(x => x.comment.id === c.id));
      const text = blockText(block);
      if (!text.trim()) continue;
      const controls = document.createElement('span');
      controls.className = 'annotation-control';
      controls.dataset.annotationIgnore = '';
      if (related.length) {
        block.classList.add('annotation-has-thread');
        const count = document.createElement('button'); count.type = 'button';
        count.className = 'annotation-count'; count.dataset.annotationList = block.dataset.annotationBlock;
        count.setAttribute('aria-label', `查看本段 ${related.length} 条批注`);
        count.innerHTML = `${icon('comment')}<span>${related.length}</span>`;
        controls.append(count);
      }
      const add = document.createElement('button'); add.type = 'button';
      add.className = 'annotation-add'; add.dataset.annotationAdd = block.dataset.annotationBlock;
      add.setAttribute('aria-label', '批注此段'); add.title = '批注此段'; add.innerHTML = icon('pen');
      // Whole paragraph annotations obey the same quote limit as selections.
      if (text.length <= 2000) controls.append(add);
      if (controls.childElementCount) { block.append(controls); decorations.push(controls); }
    }
    root.classList.toggle('annotation-mode', mode);
    rangesPaint();
  }
  function avatar(id) { const m = person(id); return `<span class="avatar ${esc(m.color || 'sage')}" aria-hidden="true">${esc(m.initial || m.name?.[0] || '同')}</span>`; }
  function quote(anchor) {
    const range = rangeForAnchor(root, anchor);
    let excerpt = esc(anchor.quote);
    if (range) {
      // Copy only the already-sanitized rendered article. In particular, keep
      // KaTeX's visual and accessible markup rather than displaying raw TeX.
      const container = document.createElement('div');
      const fragment = range.cloneContents();
      const context = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
      if (context?.closest('.katex-display')) {
        const display = document.createElement('span'); display.className = 'katex-display'; display.append(fragment); container.append(display);
      } else container.append(fragment);
      container.querySelectorAll('[data-annotation-ignore], .annotation-control, .footnote-ref, .footnote-backref').forEach(node => node.remove());
      container.querySelectorAll('*').forEach(node => {
        for (const attribute of [...node.attributes]) {
          if (attribute.name === 'id' || attribute.name.startsWith('data-annotation-')) node.removeAttribute(attribute.name);
        }
      });
      excerpt = `<div class="annotation-excerpt">${container.innerHTML}</div>`;
    }
    return `<blockquote class="annotation-quote">${excerpt}</blockquote>${range ? '' : '<p class="annotation-unavailable">原文位置已变化，保留当时引用。</p>'}`;
  }
  function commentHTML(c, rootId) {
    const parent = c.replyTo && c.replyTo !== rootId ? byId(c.replyTo) : null;
    return `<article class="annotation-comment" data-annotation-comment="${esc(c.id)}"><div class="annotation-comment-meta">${avatar(c.authorId)}<a href="#/people/${encodeURIComponent(c.authorId)}">${esc(person(c.authorId).name)}</a><time datetime="${esc(c.createdAt)}">${date(c.createdAt)}</time>${editedLabel(c)}</div>${parent ? `<p class="annotation-reply-context">回复 ${esc(person(parent.authorId).name)}</p>` : ''}<div class="prose annotation-comment-body">${markdown(c.body, 'annotation-' + c.id).html}</div><div class="annotation-comment-actions"><button type="button" class="text-button" data-annotation-reply="${esc(c.id)}"${view.kind === 'edit' ? ' disabled' : ''}>回复</button>${c.authorId === me.id && onEdit ? `<button type="button" class="text-button" data-annotation-edit="${esc(c.id)}">编辑</button>` : ''}${c.authorId === me.id || me.role === 'admin' ? `<button type="button" class="text-button" data-annotation-hide="${esc(c.id)}">隐藏</button>` : ''}</div>${pendingHide === c.id ? `<div class="annotation-confirm"><span>隐藏后，其他成员将无法看到。</span><button type="button" class="text-button" data-annotation-cancel-hide>取消</button><button type="button" class="text-button" data-annotation-confirm-hide="${esc(c.id)}">确认隐藏</button></div>` : ''}</article>`;
  }
  function formHTML() {
    const data = draft(), editing = view.kind === 'edit', reply = !editing && data.replyTo && byId(data.replyTo);
    return `<form class="annotation-form${editing ? ' annotation-edit-form' : ''}"><label for="annotation-body">${editing ? '修改内容' : view.kind === 'new' ? '写批注' : reply ? `回复 ${esc(person(reply.authorId).name)}` : '回复批注'}</label>${editing ? '<button class="text-button annotation-cancel-reply" type="button" data-annotation-cancel-edit>取消编辑</button>' : reply ? '<button class="text-button annotation-cancel-reply" type="button" data-annotation-cancel-reply>取消回复</button>' : ''}<textarea id="annotation-body" name="annotation-body" rows="3" maxlength="5000" required placeholder="写下你的想法…">${esc(data.body)}</textarea><div class="annotation-form-bottom"><span>受邀成员可见</span><button class="btn small" type="submit">${editing ? '保存修改' : view.kind === 'new' ? '发表批注' : '发表回复'}</button></div><p class="annotation-error" role="alert"></p></form>`;
  }
  function renderDrawer({focus = false} = {}) {
    const current = ['thread', 'edit'].includes(view.kind) ? byId(view.id) : null;
    if (['thread', 'edit'].includes(view.kind) && !current) view = {kind: 'list', blockId: null};
    if (view.kind === 'edit' && !byId(view.editId)) { drafts.delete(draftKey()); view = {kind: 'thread', id: view.id}; }
    let title = view.kind === 'edit' ? (byId(view.editId)?.replyTo ? '编辑回复' : '编辑批注') : view.kind === 'new' ? '写批注' : '批注', content = '';
    if (view.kind === 'list') {
      const list = roots().filter(c => !view.blockId || c.anchor.blockId === view.blockId);
      content = `${list.length ? `<div class="annotation-thread-list">${list.map(c => `<button class="annotation-thread-preview" type="button" data-annotation-thread="${esc(c.id)}"><span class="annotation-preview-quote">${esc(c.anchor.quote)}</span><span class="annotation-preview-person">${avatar(c.authorId)}${esc(person(c.authorId).name)}<span>${date(c.createdAt)}</span></span><span class="annotation-preview-body">${esc(c.body)}</span>${thread(c.id).length > 1 ? `<span class="annotation-preview-count">${thread(c.id).length - 1} 条回复</span>` : ''}</button>`).join('')}</div>` : '<p class="annotation-empty">暂无批注。</p>'}<button class="btn secondary small annotation-choose" type="button" data-annotation-choose>选择段落写批注 ${icon('pen')}</button>`;
      activePaint(null);
    } else {
      const anchor = view.kind === 'new' ? view.anchor : current.anchor;
      const list = view.kind === 'new' ? [] : thread(current.id);
      content = `${quote(anchor)}${list.length ? `<div class="annotation-comments">${list.map(c => commentHTML(c, current.id)).join('')}</div>` : ''}${formHTML()}`;
      activePaint(anchor);
    }
    drawer.setAttribute('aria-busy', String(busy));
    drawer.innerHTML = `<header class="annotation-drawer-header">${view.kind !== 'list' || view.blockId ? `<button class="icon-button" type="button" data-annotation-back aria-label="返回批注列表">${icon('back')}</button>` : ''}<h2 id="annotation-heading">${title}${view.kind === 'list' ? `<span>${roots().length}</span>` : ''}</h2><button class="icon-button" type="button" data-annotation-close aria-label="关闭批注">${icon('close')}</button></header><div class="annotation-drawer-content">${content}</div><p class="annotation-global-error" role="alert"></p>`;
    if (focus) drawer.querySelector(view.kind === 'list' ? '[data-annotation-thread], [data-annotation-choose]' : 'textarea')?.focus({preventScroll: true});
  }
  function show(next, source) {
    mode = false; root.classList.remove('annotation-mode'); modeButton.hidden = true;
    saveDraft(); pendingHide = null; view = next;
    if (!drawer.open) returnFocus = source && source !== selectionButton ? source : root;
    clearSelection();
    document.getSelection()?.removeAllRanges();
    renderDrawer();
    if (!drawer.open) drawer.showModal();
    drawer.querySelector(view.kind === 'new' ? 'textarea' : '[data-annotation-close]')?.focus({preventScroll: true});
  }
  function restoreFocus() {
    const target = returnFocus?.isConnected && returnFocus.matches('button,a[href],input,textarea,select,[tabindex]') ? returnFocus : root;
    if (target.isConnected) target.focus({preventScroll: true});
  }
  function close() { saveDraft(); drawer.close(); activePaint(null); clearSelection(); restoreFocus(); }
  function choose() {
    close(); mode = true; root.classList.add('annotation-mode'); modeButton.hidden = false;
    const button = root.querySelector('[data-annotation-add]');
    button?.focus({preventScroll: false});
    notify('选择一段文字，或点段落旁的笔。');
  }
  function selectionUpdate() {
    if (destroyed || drawer.open || busy) return;
    const selection = document.getSelection();
    const anchor = selectionAnchor(root, selection);
    if (!anchor || anchor.quote.length > 2000) { clearSelection(); return; }
    candidate = anchor;
    const range = rangeForAnchor(root, anchor), rects = range ? [...range.getClientRects()] : [];
    const rect = rects.find(r => r.bottom >= 0 && r.top < innerHeight);
    if (!rect) { selectionButton.hidden = true; return; }
    selectionButton.hidden = false;
    const width = selectionButton.offsetWidth || 104;
    selectionButton.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.left + rect.width / 2 - width / 2))}px`;
    const top = rect.top >= 52 ? rect.top - 46 : Math.min(innerHeight - 48, rect.bottom + 8);
    selectionButton.style.top = `${Math.max(8, top)}px`;
  }
  listen(document, 'selectionchange', () => {
    if (drawer.open || selectionButton === document.activeElement) return;
    clearTimeout(selectionTimer); selectionTimer = setTimeout(selectionUpdate, 100);
  });
  listen(document, 'pointerup', event => {
    if (root.contains(event.target)) { clearTimeout(selectionTimer); selectionTimer = setTimeout(selectionUpdate, 0); }
  });
  listen(modeButton, 'click', () => { mode = false; root.classList.remove('annotation-mode'); modeButton.hidden = true; root.focus({preventScroll: true}); });
  listen(document, 'keydown', event => { if (event.key === 'Escape' && mode && !drawer.open) { mode = false; root.classList.remove('annotation-mode'); modeButton.hidden = true; root.focus({preventScroll: true}); } });
  listen(selectionButton, 'pointerdown', event => event.preventDefault());
  listen(selectionButton, 'click', () => { if (candidate) show({kind: 'new', anchor: candidate}, selectionButton); });
  listen(window, 'scroll', () => { if (candidate) selectionUpdate(); }, {passive: true});
  listen(window, 'resize', () => { if (candidate) selectionUpdate(); scheduleFallback(); });
  listen(root, 'scroll', scheduleFallback, {passive: true, capture: true});
  const resizeObserver = !canHighlight && typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleFallback) : null;
  resizeObserver?.observe(root);
  listen(root, 'click', event => {
    const listButton = event.target.closest('[data-annotation-list]');
    if (listButton) { event.preventDefault(); show({kind: 'list', blockId: listButton.dataset.annotationList}, listButton); return; }
    const addButton = event.target.closest('[data-annotation-add]');
    if (addButton) {
      event.preventDefault(); const anchor = anchorForBlock(addButton.closest('[data-annotation-block]'));
      if (anchor && anchor.quote.length <= 2000) show({kind: 'new', anchor}, addButton);
      return;
    }
    if (event.target.closest('a, button') || document.getSelection()?.toString()) return;
    const hits = rangeEntries.filter(({range}) => [...range.getClientRects()].some(r => event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom));
    if (hits.length === 1) show({kind: 'thread', id: hits[0].comment.id}, event.target.closest('[data-annotation-block]'));
    else if (hits.length > 1) show({kind: 'list', blockId: hits[0].comment.anchor.blockId}, event.target.closest('[data-annotation-block]'));
  });
  listen(drawer, 'click', async event => {
    const el = event.target.closest('button'); if (!el || busy) return;
    if (el.hasAttribute('data-annotation-close')) { close(); return; }
    if (el.hasAttribute('data-annotation-back')) { saveDraft(); view = {kind: 'list', blockId: null}; pendingHide = null; renderDrawer({focus: true}); return; }
    if (el.hasAttribute('data-annotation-choose')) { choose(); return; }
    if (el.dataset.annotationThread) { saveDraft(); view = {kind: 'thread', id: el.dataset.annotationThread}; pendingHide = null; renderDrawer(); drawer.querySelector('[data-annotation-close]')?.focus({preventScroll: true}); return; }
    if (el.dataset.annotationEdit) {
      const comment = byId(el.dataset.annotationEdit);
      if (!comment || comment.authorId !== me.id || !onEdit) return;
      saveDraft(); pendingHide = null;
      const key = `edit:${comment.id}`;
      if (!drafts.has(key)) drafts.set(key, {body: comment.body, originalBody: comment.body, expectedRevision: comment.revision || 1});
      view = {kind: 'edit', id: comment.threadId || comment.id, editId: comment.id};
      renderDrawer({focus: true}); drawer.querySelector('.annotation-form')?.scrollIntoView({block: 'nearest'}); return;
    }
    if (el.hasAttribute('data-annotation-cancel-edit')) {
      const editedId = view.editId;
      drafts.delete(draftKey()); view = {kind: 'thread', id: view.id}; pendingHide = null;
      renderDrawer();
      [...drawer.querySelectorAll('[data-annotation-edit]')].find(button => button.dataset.annotationEdit === editedId)?.focus({preventScroll: true});
      return;
    }
    if (el.dataset.annotationReply) { if (view.kind === 'edit') return; saveDraft(); drafts.set(draftKey(), {...draft(), replyTo: el.dataset.annotationReply}); renderDrawer({focus: true}); return; }
    if (el.hasAttribute('data-annotation-cancel-reply')) { saveDraft(); drafts.set(draftKey(), {...draft(), replyTo: null}); renderDrawer({focus: true}); return; }
    if (el.dataset.annotationHide) { saveDraft(); pendingHide = el.dataset.annotationHide; renderDrawer(); drawer.querySelector('[data-annotation-confirm-hide]')?.focus(); return; }
    if (el.hasAttribute('data-annotation-cancel-hide')) { pendingHide = null; saveDraft(); renderDrawer(); return; }
    if (el.dataset.annotationConfirmHide) {
      setBusy(true);
      try {
        const result = await onHide(el.dataset.annotationConfirmHide);
        if (destroyed) return;
        all = result; pendingHide = null;
        if (['thread', 'edit'].includes(view.kind) && !byId(view.id)) { drafts.delete(draftKey()); view = {kind: 'list', blockId: null}; }
        paint(); renderDrawer({focus: true});
      } catch (error) { if (!destroyed) drawer.querySelector('.annotation-global-error').textContent = error.message || '隐藏未完成，请重试。'; }
      finally { if (!destroyed) setBusy(false); }
    }
  });
  listen(drawer, 'input', saveDraft);
  listen(drawer, 'cancel', event => { event.preventDefault(); if (!busy) close(); });
  listen(drawer, 'close', () => { activePaint(null); if (!destroyed) restoreFocus(); });
  listen(drawer, 'submit', async event => {
    event.preventDefault(); if (busy) return;
    saveDraft();
    const data = draft(), key = draftKey(), editing = view.kind === 'edit';
    if (!data.body.trim()) { drawer.querySelector('.annotation-error').textContent = '请填写内容。'; return; }
    const editId = editing ? view.editId : null;
    const payload = editing ? {id: editId, body: data.body, expectedRevision: data.expectedRevision} : {body: data.body, replyTo: view.kind === 'thread' ? data.replyTo || view.id : null, ...(view.kind === 'new' ? {anchor: view.anchor} : {})};
    const oldRoot = ['thread', 'edit'].includes(view.kind) ? view.id : null;
    const known = new Set(all.map(c => c.id));
    setBusy(true); const submit = drawer.querySelector('[type="submit"]'); submit.textContent = editing ? '正在保存…' : '正在发表…';
    drawer.querySelector('.annotation-error').textContent = '';
    try {
      const result = await (editing ? onEdit(payload) : onSubmit(payload));
      if (destroyed) return;
      all = result; drafts.delete(key);
      const created = all.find(c => !known.has(c.id) && c.authorId === me.id);
      view = {kind: 'thread', id: oldRoot || created?.threadId || created?.id};
      paint(); renderDrawer({focus: !editing});
      if (editing) {
        const entry = [...drawer.querySelectorAll('[data-annotation-comment]')].find(el => el.dataset.annotationComment === editId);
        entry?.scrollIntoView({block: 'nearest'}); entry?.querySelector('[data-annotation-edit]')?.focus({preventScroll: true});
      } else drawer.querySelector('.annotation-form')?.scrollIntoView({block: 'nearest'});
      notify(editing ? '修改已保存。' : oldRoot ? '回复已发表。' : '批注已发表。');
    } catch (error) {
      if (!destroyed) {
        drawer.querySelector('.annotation-error').textContent = error.message || (editing ? '修改未保存，请重试。' : '发表未完成，请重试。');
        submit.textContent = editing ? '保存修改' : view.kind === 'new' ? '发表批注' : '发表回复';
      }
    } finally { if (!destroyed) setBusy(false); }
  });
  paint();
  return {
    open(source) { show({kind: 'list', blockId: null}, source); },
    isBusy() { return drawer.open || busy || mode || !!candidate || [...drafts.entries()].some(([key, data]) => key.startsWith('edit:') ? data.body !== data.originalBody : data.body.trim()); },
    destroy() {
      destroyed = true; clearSelection(); listeners.forEach(remove => remove());
      resizeObserver?.disconnect(); if (fallbackFrame !== null) cancelAnimationFrame(fallbackFrame); fallbackLayer.remove();
      if (drawer.open) drawer.close(); drawer.remove(); selectionButton.remove(); modeButton.remove();
      decorations.forEach(el => el.remove()); root.classList.remove('annotation-mode', 'annotation-fallback');
      if (originalTabIndex === null) root.removeAttribute('tabindex'); else root.setAttribute('tabindex', originalTabIndex);
      root.querySelectorAll('.annotation-has-thread').forEach(el => el.classList.remove('annotation-has-thread'));
      if (canHighlight) { CSS.highlights.delete(highlightKey); CSS.highlights.delete(activeKey); }
      drafts.clear(); rangeEntries = []; activeRanges = []; all = [];
    },
  };
}
