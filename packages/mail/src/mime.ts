import MailComposer from 'nodemailer/lib/mail-composer';

export interface Mime {
  from: { name: string; address: string };
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Our own `Message-ID`, `<…@domain>`. */
  messageId: string;
  /** Earlier messages in the thread, oldest first: sets `In-Reply-To` and `References`. */
  references?: string[];
  /** RFC 8058 one-click POST URL and a `mailto:` fallback, for `List-Unsubscribe`. */
  unsubscribe?: { oneClick: string; mailto: string };
  date?: Date;
}

/** Builds the raw RFC 5322 message (text + HTML alternatives, no attachments). */
export function buildMime(m: Mime): Promise<Buffer> {
  const last = m.references?.at(-1);
  return new MailComposer({
    from: m.from,
    to: m.to,
    subject: m.subject,
    text: m.text,
    html: m.html,
    messageId: m.messageId,
    date: m.date ?? new Date(),
    ...(last && { inReplyTo: last, references: m.references }),
    headers: m.unsubscribe
      ? {
          'List-Unsubscribe': `<${m.unsubscribe.oneClick}>, <${m.unsubscribe.mailto}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        }
      : {},
  })
    .compile()
    .build();
}
