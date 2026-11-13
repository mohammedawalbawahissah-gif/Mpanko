import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { useSeo } from "./seo";
import { Alert, Loading, useAsync } from "./components";

interface LegalPage { slug: string; title: string; body: string; version: number; updated_at: string | null; is_draft: boolean }

/** Plain text with "# heading" lines and blank-line paragraphs; rendered as elements, never as HTML. */
function renderBody(body: string) {
  return body.split(/\n{2,}/).map((block, i) => {
    const t = block.trim();
    if (!t) return null;
    if (t.startsWith("# ")) {
      const [head, ...rest] = t.split("\n");
      return (
        <div key={i}>
          <h2>{head.replace(/^#\s+/, "")}</h2>
          {rest.join("\n").trim() && <p>{rest.join("\n").trim()}</p>}
        </div>
      );
    }
    return <p key={i}>{t}</p>;
  });
}

export function Legal({ slug }: { slug: string }) {
  const { data, loading, error } = useAsync(() => api<LegalPage>(`/pages/${slug}/`), [slug]);
  useSeo(data?.title);
  if (loading) return <Loading />;
  if (error || !data) return <div className="wrap page narrow"><Alert>This page isn't available right now.</Alert></div>;
  return (
    <div className="wrap page narrow">
      <h1>{data.title}</h1>
      {data.is_draft && <Alert kind="info">This page is still being finalised by the store.</Alert>}
      {data.updated_at && <p className="small muted">Last updated {new Date(data.updated_at).toLocaleDateString()}</p>}
      {renderBody(data.body)}
    </div>
  );
}

const KEY = "mpanko.cookie-notice";

/** We only use what the shop needs to work, so this is a notice, not a consent wall. */
export function CookieNotice() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { setShow(!localStorage.getItem(KEY)); } catch { setShow(false); }
  }, []);
  if (!show) return null;
  const dismiss = () => {
    try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ }
    setShow(false);
  };
  return (
    <div className="cookie-notice" role="region" aria-label="Cookie notice">
      <p className="small">Mpanko only stores what it needs to keep you signed in and remember your bag and currency. No advertising or tracking. <Link to="/cookies">Read more</Link></p>
      <button className="btn quiet" onClick={dismiss}>Got it</button>
    </div>
  );
}
