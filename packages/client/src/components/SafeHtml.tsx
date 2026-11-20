import { useEffect, useRef } from 'react';

const ALLOWED_TAGS = new Set(['p', 'b', 'i', 'strong', 'em', 'span', 'div', 'br', 'ul', 'li', 'img', 'h1', 'h2']);
const ALLOWED_ATTRS = new Set(['class', 'src', 'alt']);

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
    if (!ALLOWED_TAGS.has(tag)) {
      return null;
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
