import { useEffect } from "react";

function setMeta(selector: string, attr: string, key: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = value;
}

/** Keeps the tab title and description right as the shopper navigates (the prerendered files cover first loads and crawlers). */
export function useSeo(title: string | undefined, description?: string) {
  useEffect(() => {
    if (!title) return;
    document.title = `${title} · Mpanko`;
    if (description) {
      setMeta('meta[name="description"]', "name", "description", description.slice(0, 300));
      setMeta('meta[property="og:description"]', "property", "og:description", description.slice(0, 300));
    }
    setMeta('meta[property="og:title"]', "property", "og:title", title);
  }, [title, description]);
}
