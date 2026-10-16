import type { Locale, ReplyIntent } from '@sutra/domain';

/** One labelled reply for the eval set: the raw inbound text, its language, and the expected intent. */
export interface ReplyEvalCase {
  reply: string;
  locale: Locale;
  expected: ReplyIntent;
}

/**
 * 40 real-shaped replies across six languages (English, Japanese, Bahasa Indonesia, Hindi,
 * Vietnamese, Simplified Chinese) with their expected intent. The `replyAnalyst` LLM is measured
 * against this set (target ≥ 90% intent accuracy); the offline heuristic analyser is measured
 * against it in CI (`eval.test.ts`).
 */
export const replyEvalSet: ReplyEvalCase[] = [
  // English
  {
    reply: 'Interested. Can we talk next Tuesday afternoon?',
    locale: 'en',
    expected: 'meeting_request',
  },
  {
    reply: 'Could you share pricing for about 2,000 units a month?',
    locale: 'en',
    expected: 'question',
  },
  {
    reply: 'This looks too expensive for our budget right now.',
    locale: 'en',
    expected: 'objection',
  },
  { reply: 'Not right now, maybe next quarter.', locale: 'en', expected: 'not_now' },
  { reply: 'We already have a supplier, thanks.', locale: 'en', expected: 'not_interested' },
  { reply: 'Please remove me from your list.', locale: 'en', expected: 'unsubscribe' },
  { reply: "I'm out of office until Monday.", locale: 'en', expected: 'out_of_office' },
  { reply: 'You should reach out to our head of ops, Jane.', locale: 'en', expected: 'referral' },
  { reply: "I'm the wrong person for this, sorry.", locale: 'en', expected: 'wrong_person' },
  { reply: 'Got it, thanks.', locale: 'en', expected: 'other' },

  // Japanese
  { reply: '来週火曜の午後なら大丈夫です。', locale: 'ja', expected: 'meeting_request' },
  { reply: '配信停止をお願いします。', locale: 'ja', expected: 'unsubscribe' },
  { reply: '興味があります。ぜひお願いします。', locale: 'ja', expected: 'interested' },
  { reply: '料金を教えてください。', locale: 'ja', expected: 'question' },
  { reply: '来四半期にまたご連絡ください。', locale: 'ja', expected: 'not_now' },
  { reply: '興味はありません。', locale: 'ja', expected: 'not_interested' },
  { reply: '担当者にご連絡ください。', locale: 'ja', expected: 'referral' },

  // Bahasa Indonesia
  { reply: 'Saya tertarik, ceritakan lebih banyak.', locale: 'id', expected: 'interested' },
  { reply: 'Bisa jadwalkan panggilan minggu depan?', locale: 'id', expected: 'meeting_request' },
  { reply: 'Berapa harga untuk 1.000 unit?', locale: 'id', expected: 'question' },
  { reply: 'Terlalu mahal untuk anggaran kami.', locale: 'id', expected: 'objection' },
  { reply: 'Tidak tertarik, terima kasih.', locale: 'id', expected: 'not_interested' },
  { reply: 'Mohon berhenti berlangganan.', locale: 'id', expected: 'unsubscribe' },
  { reply: 'Saya sedang cuti sampai Senin.', locale: 'id', expected: 'out_of_office' },

  // Hindi
  { reply: 'मुझे इसमें रुचि है, और बताइए।', locale: 'hi', expected: 'interested' },
  { reply: 'कृपया मीटिंग शेड्यूल करें।', locale: 'hi', expected: 'meeting_request' },
  { reply: 'कीमत क्या है?', locale: 'hi', expected: 'question' },
  { reply: 'मुझे सूची से हटा दें।', locale: 'hi', expected: 'unsubscribe' },
  { reply: 'अभी नहीं, अगली तिमाही में।', locale: 'hi', expected: 'not_now' },
  { reply: 'कृपया सही व्यक्ति से संपर्क करें।', locale: 'hi', expected: 'referral' },

  // Vietnamese
  { reply: 'Tôi quan tâm, muốn biết thêm.', locale: 'vi', expected: 'interested' },
  { reply: 'Sắp xếp cuộc họp tuần tới nhé?', locale: 'vi', expected: 'meeting_request' },
  { reply: 'Giá bao nhiêu cho 500 chiếc?', locale: 'vi', expected: 'question' },
  { reply: 'Không quan tâm, cảm ơn.', locale: 'vi', expected: 'not_interested' },
  { reply: 'Vui lòng hủy đăng ký.', locale: 'vi', expected: 'unsubscribe' },

  // Simplified Chinese
  { reply: '我很感兴趣，想了解更多。', locale: 'zh', expected: 'interested' },
  { reply: '可以安排通话吗？周二下午方便。', locale: 'zh', expected: 'meeting_request' },
  { reply: '价格是多少？', locale: 'zh', expected: 'question' },
  { reply: '请退订。', locale: 'zh', expected: 'unsubscribe' },
  { reply: '我们已经有供应商了，谢谢。', locale: 'zh', expected: 'not_interested' },
];
