import {esc} from './render.js';
import {contentLicense,licenseName,licenseURL} from './license-policy.js';
export {contentLicense} from './license-policy.js';

const licenseLink = `<a href="${licenseURL}" target="_blank" rel="license noopener noreferrer">${licenseName}</a>`;
const itemLink = item => item.license === contentLicense ? licenseLink : item.license === 'CC-BY-SA-4.0' ? '<a href="https://creativecommons.org/licenses/by-sa/4.0/deed.zh-hans" target="_blank" rel="license noopener noreferrer">CC BY-SA 4.0</a>' : '';

export function licenseConsent({required = true, checked = false} = {}) {
  return `<label class="license-consent"><input type="checkbox" name="licenseConfirmed" value="yes"${required ? ' required' : ''}${checked ? ' checked' : ''}><span>${required ? '' : '可选：'}我有权将本次原创内容按 ${licenseLink} 公开授权（仅限非商业使用，须署名并以相同方式共享）。授权不可撤回。<a href="#/about?section=license">授权说明</a></span></label>`;
}

export function licenseBadge(item) {
  const link = itemLink(item);
  return link ? `<span class="license-badge">${link}</span>` : '';
}

export function licenseNotice(item, author) {
  if (item.kind === 'translation') return '';
  const link = itemLink(item);
  return `<p class="content-license">© ${esc(author)} · ${link ? `${link} · ${item.license === contentLicense ? '仅限非商业使用。' : ''}转载须保留署名、作品链接与许可，修改须注明。引用等第三方内容依原许可。` : '原有授权保留；转载或改编请先联系作者。'}</p>`;
}
