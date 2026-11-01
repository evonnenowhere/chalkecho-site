import {esc} from './render.js';

export const contentLicense = 'CC-BY-SA-4.0';
export const licenseURL = 'https://creativecommons.org/licenses/by-sa/4.0/deed.zh-hans';
const licenseLink = `<a href="${licenseURL}" target="_blank" rel="license noopener noreferrer">CC BY-SA 4.0</a>`;

export function licenseConsent({required = true, checked = false} = {}) {
  return `<label class="license-consent"><input type="checkbox" name="licenseConfirmed" value="yes"${required ? ' required' : ''}${checked ? ' checked' : ''}><span>${required ? '' : '可选：'}我有权将本次原创内容按 ${licenseLink} 公开授权（允许商用，须署名并以相同方式共享）。授权不可撤回。<a href="#/about?section=license">授权说明</a></span></label>`;
}

export function licenseBadge(item) {
  return item.license === contentLicense ? `<span class="license-badge">${licenseLink}</span>` : '';
}

export function licenseNotice(item, author) {
  if (item.kind === 'translation') return '';
  return `<p class="content-license">© ${esc(author)} · ${item.license === contentLicense ? `${licenseLink} · 转载须保留署名、作品链接与许可，修改须注明。引用等第三方内容依原许可。` : '原有授权保留；转载或改编请先联系作者。'}</p>`;
}
