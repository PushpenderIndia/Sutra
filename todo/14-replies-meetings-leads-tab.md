# PR 14 — Replies, meetings and Leads tab

**Branch:** `feat/14-replies-meetings-leads-tab` · **Depends on:** 13 · **Size:** M

## Why
Replies are where deals happen. Understand every reply in any language, sort contacts into **Interested / Not interested**, book meetings, and show it all in the **Leads** tab.

## `replyAnalyst` agent (`sutra-smart`, triggered by `reply.received`)
Input: the reply (untrusted), the thread, contact, profile and ICP. Output:
```ts
export const replyAnalysis = z.object({
  intent: z.enum(['interested', 'meeting_request', 'question', 'objection', 'not_now', 'not_interested',
                  'unsubscribe', 'out_of_office', 'wrong_person', 'referral', 'other']),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  language: locale,
  summaryEn: z.string().max(200),
  proposedTimes: z.array(z.object({ start: z.iso.datetime(), end: z.iso.datetime() })).optional(),
  followUpAt: z.iso.datetime().optional(),
  referral: z.object({ name: z.string(), email: z.email().optional() }).optional(),
  suggestedReply: z.string().optional(),
});
```

## Deterministic action map (data)
```ts
const onIntent: Record<Intent, Action[]> = {
  interested:      ['stopEnrollment', 'status:interested', 'draftReply:offerSlots'],
  meeting_request: ['stopEnrollment', 'status:interested', 'draftReply:offerSlots'],
  question:        ['stopEnrollment', 'status:interested', 'draftReply:answer'],
  objection:       ['stopEnrollment', 'status:engaged', 'draftReply:answer'],
  not_now:         ['pauseUntil:followUpAt', 'status:not_now'],
  out_of_office:   ['pauseUntil:followUpAt'],
  not_interested:  ['stopEnrollment', 'status:not_interested'],
  unsubscribe:     ['optOut', 'status:not_interested'],
  wrong_person:    ['stopEnrollment', 'draftReply:askReferral'],
  referral:        ['createContactFromReferral', 'draftReply:thankReferral'],
  other:           ['notifyHuman'],
};
```
- **Reply drafts always need approval** before sending (shown in the Leads tab and the chat); there's no auto-reply
- Each reply records its **variant attribution** (which variant, at which step, earned the reply), which feeds the optimizer (PR 15)

## Meetings (Google Calendar)
- `offerSlots`: `freebusy.query` on the sender's calendar → 3 slots in the **contact's timezone** inside business hours
- When the contact accepts a time: `events.insert` with a Google Meet link + the attendee → `meetings` doc → status `meeting_booked` → audit
- `checkAvailability` and `bookMeeting` are also ADK `FunctionTool`s for the chat copilot (PR 16)

## Leads tab
```
┌ Interested 12 ┐ ┌ Meeting booked 4 ┐ ┌ Not interested 7 ┐ ┌ Awaiting reply 186 ┐ ┌ Not now 3 ┐
└───────────────┘ └──────────────────┘ └──────────────────┘ └────────────────────┘ └───────────┘
┌──────────────────────────────── table ───────────────────────────────────────────────────┐
│ contact │ company │ status │ intent │ last reply (EN summary) │ variant │ step │ updated  │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```
- Cards are **filters**: clicking one filters the table (the selection context updates for the chat)
- Row → a side sheet with the full **thread** (original language + English summary), the reply analysis, the drafted reply awaiting approval, and meeting details
- "Hot" sort: interested + meeting requests first

## Tasks
- [ ] `replyAnalyst` + action-map executor + variant attribution
- [ ] Calendar helpers + tools
- [ ] Reply draft approval flow
- [ ] Leads tab: status cards, table, thread sheet
- [ ] Eval set: 40 replies in 6 languages with expected intents

## Acceptance criteria
- A Japanese reply "来週火曜の午後なら大丈夫です" → `meeting_request` → Tuesday-afternoon slots in Asia/Tokyo
- "Please remove me" in any supported language → suppression within one job cycle
- Intent accuracy ≥ 90% on the eval set
- Card counts always equal the table's filtered counts
