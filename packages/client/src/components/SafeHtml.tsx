import { useEffect, useRef } from 'react';

const ALLOWED_TAGS = new Set(['p', 'b', 'i', 'strong', 'em', 'span', 'div', 'br', 'ul', 'li', 'img', 'h1', 'h2']);
const DROP_SUBTREE_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'template',
  'noscript',
  'head',
  'meta',
  'link',
]);
const ALLOWED_ATTRS = new Set(['class', 'src', 'alt']);
const SAFE_CINE_PATH_RE = /^\/img_cine\/[a-zA-Z0-9_.-]+$/;

export interface CineEmbedInfo {
  kind: 'video' | 'image';
  src: string;
  href?: string;
}

export function parseCineEmbed(embed: string | null | undefined): CineEmbedInfo | null {
  if (!embed) return null;
  if (embed.startsWith('video|')) {
    const src = embed.split('|')[1] ?? '';
    return {
      kind: 'video',
      src: SAFE_CINE_PATH_RE.test(src) ? src : '/img_cine/camera_on.gif',
    };
  }
  if (embed.startsWith('image|')) {
    const parts = embed.split('|');
    const thumb = parts[1] ?? '';
    const big = parts[2] ?? thumb;
    if (SAFE_CINE_PATH_RE.test(thumb)) {
      return {
        kind: 'image',
        src: thumb,
        href: SAFE_CINE_PATH_RE.test(big) ? big : thumb,
      };
    }
    return { kind: 'image', src: '/img_cine/camera.jpg', href: '/img_cine/camera.jpg' };
  }
  if (embed.startsWith('video:')) {
    return { kind: 'video', src: '/img_cine/camera_on.gif' };
  }
  if (embed.startsWith('image:')) {
    return { kind: 'image', src: '/img_cine/camera.jpg', href: '/img_cine/camera.jpg' };
  }
  if (SAFE_CINE_PATH_RE.test(embed)) {
    const isGif = embed.toLowerCase().endsWith('.gif');
    return { kind: isGif ? 'video' : 'image', src: embed, href: isGif ? undefined : embed };
  }
  return null;
}

function normalizeLegacyHtml(rawHtml: string): string {
  return rawHtml
    .replace(/src=['"](?:\/assets\/img\/faces\/|\/?img_faces\/)/gi, "src='/img_faces/")
    .replace(/src=['"](?:\/assets\/img\/sprites\/loading\.gif|\/?img\/loading\.gif)['"]/gi, "src='/client_img/loading.gif'")
    .replace(/\r?\n/g, '<br/>');
}

function sanitizeToNodes(rawHtml: string): Node[] {
  const normalized = normalizeLegacyHtml(rawHtml);
  const parser = new DOMParser();
  const doc = parser.parseFromString(normalized, 'text/html');

  const cleanNode = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent ?? '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (DROP_SUBTREE_TAGS.has(tag)) {
      return null;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      const frag = document.createDocumentFragment();
      for (const child of Array.from(el.childNodes)) {
        const cleanedChild = cleanNode(child);
        if (cleanedChild) frag.appendChild(cleanedChild);
      }
      return frag;
    }
    const cleanEl = document.createElement(tag);
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (!ALLOWED_ATTRS.has(name)) continue;
      if (name === 'src') {
        const v = attr.value;
        if (
          !v.startsWith('/img_faces/') &&
          !v.startsWith('/img/') &&
          !v.startsWith('/img_cine/') &&
          !v.startsWith('/client_img/')
        ) {
          continue;
        }
      }
      cleanEl.setAttribute(name, attr.value);
    }
    for (const child of Array.from(el.childNodes)) {
      const cleanedChild = cleanNode(child);
      if (cleanedChild) cleanEl.appendChild(cleanedChild);
    }
    return cleanEl;
  };

  const out: Node[] = [];
  for (const child of Array.from(doc.body.childNodes)) {
    const cleaned = cleanNode(child);
    if (cleaned) out.push(cleaned);
  }
  return out;
}

export function SafeHtml({ html, className = '' }: { html: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Always walk nodes to enforce strict local src path whitelist alongside tag/attr whitelist
    el.replaceChildren(...sanitizeToNodes(html));
  }, [html]);

  return <div ref={containerRef} className={className} />;
}
