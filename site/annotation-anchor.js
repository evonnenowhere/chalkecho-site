// Source fingerprints identify the exact Markdown block. Offsets and quotes use
// the rendered text model below; a changed block is never silently reattached.
const sourceLines = body => String(body ?? '').replace(/\r\n?/g, '\n').replace(/\0/g, '\uFFFD').split('\n');

function fingerprint(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function blockIdFor(body, startLine, endLine) {
  const lines = sourceLines(body);
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 0 || endLine <= startLine || endLine > lines.length) return null;
  return `b-${startLine}-${endLine}-${fingerprint(lines.slice(startLine, endLine).join('\n'))}`;
}

function validOffsets(anchor) {
  return !!anchor && typeof anchor === 'object' && typeof anchor.blockId === 'string'
    && anchor.detached !== true
    && typeof anchor.quote === 'string' && anchor.quote.length > 0 && anchor.quote.length <= 2000 && !!anchor.quote.trim()
    && Number.isSafeInteger(anchor.start) && Number.isSafeInteger(anchor.end)
    && anchor.start >= 0 && anchor.end > anchor.start && anchor.end <= 120000
    && anchor.end - anchor.start === anchor.quote.length;
}

export function validateAnchorSource(body, anchor) {
  if (!validOffsets(anchor)) return false;
  const match = /^b-(0|[1-9]\d*)-([1-9]\d*)-([a-f0-9]{8})$/.exec(anchor.blockId);
  return !!match && blockIdFor(body, Number(match[1]), Number(match[2])) === anchor.blockId;
}

// Search on complete source lines, including overlapping matches. More than one
// occurrence is ambiguous even when one occurrence still has the old line number.
function uniqueBlockLine(lines, rawBlock) {
  const source = `\n${lines.join('\n')}\n`, needle = `\n${rawBlock}\n`;
  const position = source.indexOf(needle);
  if (position < 0 || source.indexOf(needle, position + 1) >= 0) return null;
  let line = 0;
  for (let i = 0; i < position; i++) if (source[i] === '\n') line++;
  return line;
}

export function reanchorAfterEdit(oldBody, newBody, anchor) {
  const original = anchor && typeof anchor === 'object' && !Array.isArray(anchor) ? {...anchor} : {};
  const detached = () => ({...original, detached: true});
  // Detachment is permanent: restoring earlier wording cannot silently move a
  // discussion onto text that might now have a different meaning or location.
  if (original.detached === true) return original;
  if (typeof oldBody !== 'string' || typeof newBody !== 'string' || oldBody.length > 60000 || newBody.length > 60000) return detached();
  if (oldBody === newBody) return original;
  if (!validateAnchorSource(oldBody, original)) return detached();
  const match = /^b-(\d+)-(\d+)-[a-f0-9]{8}$/.exec(original.blockId);
  const start = Number(match[1]), end = Number(match[2]);
  const oldLines = sourceLines(oldBody), newLines = sourceLines(newBody);
  const rawBlock = oldLines.slice(start, end).join('\n');
  if (!rawBlock.trim() || uniqueBlockLine(oldLines, rawBlock) !== start) return detached();
  const nextStart = uniqueBlockLine(newLines, rawBlock);
  if (nextStart === null) return detached();
  return {...original, blockId: blockIdFor(newBody, nextStart, nextStart + end - start)};
}

// KaTeX contains both MathML and visually positioned HTML, with repeated text.
// Treat a formula as one atom represented by its original TeX instead. A text
// selection touching a formula expands to the atom's outer boundary.
const ignored = '[data-annotation-ignore], .annotation-control, .footnote-ref, .footnote-backref, [hidden], script, style';
function atomText(node) {
  if (node.nodeType !== 1) return null;
  if (node.matches('.katex')) {
    const tex = node.querySelector('annotation[encoding="application/x-tex"]');
    return tex ? `$${tex.textContent}$` : node.textContent;
  }
  if (node.matches('.katex-error')) return `$${node.textContent}$`;
  if (node.tagName === 'BR') return '\n';
  return null;
}

function segmentsFor(block) {
  const segments = [];
  let length = 0;
  const visit = node => {
    if (node.nodeType === 1 && node.matches(ignored)) return;
    const atom = atomText(node);
    if (node.nodeType === 3 || atom !== null) {
      const text = atom ?? node.data;
      if (text.length) segments.push({node, text, start: length, end: length + text.length, atom: atom !== null});
      length += text.length;
    } else for (const child of node.childNodes) visit(child);
  };
  visit(block);
  return segments;
}

export function blockText(block) {
  return segmentsFor(block).map(segment => segment.text).join('');
}

function containingBlock(node, root) {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  const block = el?.closest('[data-annotation-block]');
  return block && (root === block || root.contains(block)) ? block : null;
}

function boundaryOffset(block, container, offset, side) {
  let total = 0, found = null;
  const visit = node => {
    if (found !== null) return;
    if (node.nodeType === 1 && node.matches(ignored)) return;
    const atom = atomText(node);
    if (node.nodeType === 3) {
      if (node === container) found = total + Math.min(offset, node.data.length);
      total += node.data.length;
    } else if (atom !== null) {
      if (node === container || node.contains(container)) found = total + (side === 'end' ? atom.length : 0);
      total += atom.length;
    } else if (node === container) {
      for (const child of Array.from(node.childNodes).slice(0, offset)) total += blockText(child).length;
      found = total;
    } else for (const child of node.childNodes) visit(child);
  };
  visit(block);
  return found;
}

function trimmedAnchor(block, start, end) {
  const text = blockText(block);
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  const anchor = {blockId: block.dataset.annotationBlock, quote: text.slice(start, end), start, end};
  return validOffsets(anchor) ? anchor : null;
}

export function anchorFromRange(block, range) {
  if (!block?.dataset.annotationBlock || range.collapsed || !block.contains(range.startContainer) || !block.contains(range.endContainer)) return null;
  const start = boundaryOffset(block, range.startContainer, range.startOffset, 'start');
  const end = boundaryOffset(block, range.endContainer, range.endOffset, 'end');
  if (start === null || end === null || end <= start) return null;
  return trimmedAnchor(block, start, end);
}

export function selectionAnchor(root, selection) {
  if (!root || !selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const startBlock = containingBlock(range.startContainer, root);
  if (!startBlock || startBlock !== containingBlock(range.endContainer, root)) return null;
  return anchorFromRange(startBlock, range);
}

export function anchorForBlock(block) {
  return block?.dataset.annotationBlock ? trimmedAnchor(block, 0, blockText(block).length) : null;
}

function rangePoint(segment, offset, side) {
  if (!segment.atom) return [segment.node, offset - segment.start];
  if (offset !== segment.start && offset !== segment.end) return null;
  const index = Array.prototype.indexOf.call(segment.node.parentNode.childNodes, segment.node);
  return [segment.node.parentNode, index + (side === 'end' ? 1 : 0)];
}

export function rangeForAnchor(root, anchor) {
  if (!root || !validOffsets(anchor)) return null;
  const block = root.dataset?.annotationBlock === anchor.blockId ? root
    : Array.from(root.querySelectorAll('[data-annotation-block]')).find(el => el.dataset.annotationBlock === anchor.blockId);
  if (!block || blockText(block).slice(anchor.start, anchor.end) !== anchor.quote) return null;
  const segments = segmentsFor(block);
  const first = segments.find(segment => anchor.start >= segment.start && anchor.start < segment.end);
  const last = segments.find(segment => anchor.end > segment.start && anchor.end <= segment.end);
  if (!first || !last) return null;
  const start = rangePoint(first, anchor.start, 'start'), end = rangePoint(last, anchor.end, 'end');
  if (!start || !end) return null;
  const range = block.ownerDocument.createRange();
  range.setStart(...start);
  range.setEnd(...end);
  return range;
}
