import { callLink, emailLink, whatsappLink } from "./phone";
import { useShopConfig } from "./guest-config";
import { useT } from "./i18n";

const PATHS = {
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  call: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />,
  whatsapp: <><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /><path d="M9 9.5c.3 2 2.5 4.2 4.5 4.5l1.3-1.3-2-1-.8.8c-.8-.4-1.5-1.1-1.9-1.9l.8-.8-1-2z" /></>,
};

export function ContactIcon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg className="contact-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

/** Compact Email, Call and WhatsApp buttons with icons. They never show the address or number; each opens the right app. Hidden until the shop sets its details (placeholders while developing). */
export function ContactButtons() {
  const { t } = useT();
  const config = useShopConfig();
  const dev = import.meta.env.DEV;
  const mail = emailLink(config?.support_email, dev);
  const call = callLink(config?.support_phone, dev);
  const whatsapp = whatsappLink(config?.whatsapp_number, dev);
  if (!mail && !call && !whatsapp) return null;
  return (
    <div className="contact-row">
      {mail && <a className="contact-chip" href={mail.href}><ContactIcon name="mail" />{t("contact.email")}</a>}
      {call && <a className="contact-chip" href={call.href}><ContactIcon name="call" />{t("contact.call")}</a>}
      {whatsapp && <a className="contact-chip" href={whatsapp.href} target="_blank" rel="noopener noreferrer"><ContactIcon name="whatsapp" />{t("contact.whatsapp")}</a>}
    </div>
  );
}
