# The 10-minute demo — minute-by-minute talk track

*Audience: a principal and/or senior PM. Setting: their office or a video call.
You drive; they watch a real system, not slides. Works from a phone or tablet
(the dashboard and demo panel render at 390 px).*

## Before you walk in (2-minute pre-flight)

1. `pnpm reset:demo` (or the **Reset demo** button in the panel) — pristine state.
2. Log in as `sophie.demo@example.com` on the demo tenant. You should see the
   **Demo** badge in the header and the **Demo scenarios** button bottom-right.
3. Open `/queue` — it should be empty or near-empty. Phone on silent.

---

## Minute 0–1 — Context (no slides, just say it)

> "You know the drill: a PM's day is forty-plus emails — tenants, owners,
> tradies — and every reply has to be right under the new tenancy rules. PM
> Assistant reads every inbound email and writes the reply for you: compliant,
> in your voice. Your PM just reviews and sends. **It never sends anything on
> its own** — that's locked into the product, not a setting.
>
> This is a live system, not a mock-up. Let me show you a morning's inbox."

## Minute 1–7 — Three live scenarios (the heart)

Open the **Demo scenarios** panel. Run these three, in this order:

### 1. Urgent maintenance — "No hot water" (~2 min)

Click **Inject** on *Urgent: no hot water*. Narrate while it drafts (~15 s):

> "A tenant just emailed: no hot water, toddler at home. Watch what happens —
> this is going through the real pipeline, live."

When the draft opens: point at the badges and the green compliance panel.

> "It read the email, matched the tenant to 12 Banksia Street, classified it
> **Maintenance — Emergency**, and flagged the owner alert. See the compliance
> panel: it knows no hot water is a **statutory emergency repair** — that's
> section 214 — and the reply already references our nominated repairer, which
> is the section 218 pathway. That's not the AI guessing: those values come
> from a versioned QLD rules engine."

Edit one word. Click **Approve & Send**. (It "sends" instantly — sandboxed.)

> "And that's the whole loop: read, review, send. Thirty seconds instead of
> fifteen minutes — and the owner alert went out in parallel."

### 2. Rent arrears — owner asks (~2 min)

Inject *Rent arrears — owner asks*.

> "Now the harder one: an owner asking about late rent. This tenancy is nine
> days behind. Getting the breach-notice timing wrong here is how agencies end
> up at QCAT."

Open the draft:

> "The reply explains exactly where the tenancy stands and what the Form 11
> process is — with the notice period pulled from the rules engine, current as
> of this month's rules version. Your PM reviews it, softens or hardens the
> tone, sends. The compliance is the floor, not the vibe."

### 3. Routine inspection (~2 min)

Inject *Routine inspection due*.

> "Routine stuff is where the hours go. Tenant asks when their next inspection
> is — one's actually due. The draft proposes scheduling it **and** knows an
> entry notice is required first, with the minimum notice period — that's the
> Form 9 workflow. The PM gets a ready reply *and* the compliance breadcrumbs."

Then flick to `/properties` for 15 seconds:

> "Everything hangs off your rent roll — owners, tenants, leases, arrears and
> inspection flags. Your PMs manage it all in here."

## Minute 7–9 — Onboarding (show, don't promise)

Open `/signup` **in an incognito/private window** — signed-in users are
redirected to their queue, so the signup page only renders logged-out. (Have
the incognito tab ready before the meeting.)

> "Getting you live is deliberately boring. Magic-link sign-in — no passwords,
> no IT. Connect your rentals inbox with one Google sign-in. Upload your rent
> roll as a CSV — we read PropertyMe, Console and VaultRE exports and map the
> columns for you. Set your tone and your nominated repairer. And before
> you've finished your coffee, it drafts its first reply on a sample email so
> you see it working **before** any real email touches it."

Point at the locked guardrail on the Voice step:

> "And this is locked on: drafts only. Nothing sends without a human."

## Minute 9–10 — The close

> "Here's what I'd suggest: a **two-week pilot on a slice of your rent roll**.
> I do the setup with you — half an hour. Your PMs just review drafts. We
> measure the time saved; if it's not obvious, walk away and you owe nothing.
> If it is, it's priced per door per month — a fraction of the PM hours it
> returns. Want me to set your pilot up this week?"

Then book the onboarding session **on the spot** and hand over the intake
sheet (`docs/client-intake.csv`).

---

## Objection: "What if the AI gets the law wrong?"

Use these sentences, verbatim:

> "Three protections. **First, it never sends — ever.** Every email is a draft
> a licensed human approves; that's architectural, not a setting. **Second,
> the legal numbers don't come from the AI.** Notice periods, form numbers,
> entry rules — they come from a versioned rules engine sourced from the RTA,
> and you saw the citations on every draft. If a value isn't confirmed, the
> system refuses to guess rather than making something up. **Third, the rules
> are watched.** A monitoring bot tracks the regulatory sources, and changes
> surface for review — so when the rules move, the engine moves, deliberately.
> And to be clear: it's drafting support, not legal advice — your PM stays the
> decision-maker, which is exactly how you'd want it."

## Other quick answers

- **"Does it replace my PMs?"** — "No. It gives each PM back an hour or two a
  day, which usually means more doors per PM, not fewer PMs."
- **"Our data?"** — "Each agency is fully isolated — row-level security per
  tenant. Your book is never visible to anyone else."
- **"We use PropertyMe."** — "Keep it. This sits on the inbox, not the trust
  account. We import your rent roll from a PropertyMe export in step three."

## If something goes sideways

- Draft slow (>30 s)? Keep talking through the queue UI; it lands.
- Draft held as "do not send"? Even better: "see — when it isn't sure, it
  refuses to send and tells the PM why. That's the safety working."
- Total failure? `/properties` + `/documents` still demo the depth; offer the
  live first-draft moment in the onboarding flow instead.

*After every meeting: hit **Reset demo** so the next one starts pristine.*
