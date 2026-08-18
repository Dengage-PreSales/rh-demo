# The emails, and the order to build them in

## Send the diagnostic first. Nothing else is worth building until it comes back

`diagnostic-email.html` exists to answer one question that no one has answered
yet: **can an email read a contact's postcode and pass it to our endpoint?**

Everything else in the chain is already proven and was tested rather than
assumed:

| Checked on 16 August 2026 | Result |
|---|---|
| The endpoint answers over GET, which is what the panel requires | works |
| The publishable key works in a header and in the URL | both work |
| A request with no key | refused, 401 |
| Every blank or broken parameter a panel can send | ordinary JSON, `ok` true |
| The response shape is the object itself, not wrapped in an array | confirmed |

What is not proven is the merge tag syntax, and it is the one thing we cannot
test from outside the panel. So the diagnostic prints several candidates side by
side rather than betting on one.

### What to do

1. **Content > Email > Code Editor > New.** Paste `diagnostic-email.html` whole.
2. Subject: `rh diagnostic`. It does not matter, nobody outside the project sees it.
3. Make sure at least one test contact has a postcode set. `01310-100` is the
   São Paulo one the demo uses, so it will resolve to a real shop.
4. Send it to yourself and to that contact.
5. **Send me back what arrived**, a screenshot is fine.

### How to read what comes back

The email has five sections and they narrow the problem between them.

| Section | If it fills in | If it is empty |
|---|---|---|
| **A** every attribute this contact has | we know the exact postcode column name outright, and B is only confirmation | the `$Contact` object is not reachable that way; B still tells us the answer |
| **B** seven candidate syntaxes | whichever row has a value is the syntax the real email uses | none of the usual forms work, and I will need one more round |
| **C** the endpoint with no parameters at all | the Custom API feature works inside a send. This is the big one | the problem is the endpoint feature or its definition, not our code |
| **D** this contact's postcode through the endpoint | the whole chain works and the real email is a formatting job | compare with C: if C worked and D did not, only the tag is wrong |
| **E** a product rendered with picture and price | the Use Case 1 email is finished work, not engineering | expected to be empty if D was |

**The most useful failure is C working and D not.** That means the plumbing is
sound and only the postcode tag is wrong, which is a five minute fix.

The diagnostic deliberately never uses `$blockSend`. A diagnostic that refuses
to send when something is wrong tells you nothing.

## Then the real one

`uc1-offer-email.html` is the Use Case 1 email: one campaign, two contacts with
different postcodes, different products, and one visible substitution. It is
written against whichever syntax the diagnostic proves, so it is deliberately
not finished until that comes back. Building it on a guess is how a demo breaks
in front of executives.

## If Supabase is ever slow on the day

Change one word. The email calls `$CustomApi.rh_offer(...)`; the standby is
`$CustomApi.rh_offer_static(...)`, which reads a pre-rendered answer published on
our own site with exactly the same shape. Both endpoint definitions are in
`../custom-api-endpoints.md` and should both exist before the session so the
switch is an edit rather than a setup.

---

## The Subject and Pre-header fields

**The Subject field runs the template engine.** Proven in the panel on 18 August
2026: an expression calling `$CustomApi.rh_email` and `JSON.parse` previewed as a
real shop name rather than as literal text. So the subject can name the shop the
message is about, which is the whole use case stated in an inbox line.

**It also introduces the one failure worth engineering against.** The subject
resolves a shop independently of the body. If its logic drifts from the body's by
a line, the inbox names one shop and the message names another, and on a shared
screen that reads as the platform guessing. The first test did exactly this: it
hardcoded Sao Paulo's postcode and previewed "Still at PBKIDS SHOPPING ELDORADO"
above a message about Praia de Belas.

So the subject is **generated from the body, never written beside it**:

```
node tools/build-subject.mjs
```

That lifts the body's own script block, strips only comments and blank lines, and
appends the subject it already computes. Drift is impossible by construction.
`node tools/render-email.mjs` then renders both through the same nine cases and
fails if any subject names a different shop from its message.

### Settled 18 August 2026: a static subject

| Field | Paste |
|---|---|
| Subject | `We checked your store, not the warehouse` |
| Pre-header | **nothing. Leave it empty** |

**The Subject field will not accept a template block, and four attempts is where
this stopped.** A 110 character expression calling `$CustomApi` saved and
previewed a real shop name, which is what made it look possible. Everything
larger was refused with "unable to create/update content", and the panel gives no
reason:

| Build | Size | Result |
|---|---|---|
| one line `$CustomApi` test | 110 | saved and previewed |
| lifted from the body | 5,765 | refused |
| purpose built, compact | 1,610 | refused |
| compact with no angle brackets | 1,727 | refused |

Length was the first theory and the compact build disproved it. Angle brackets
were the second, because the one build that worked had none, and the bracket free
build disproved that too. The third theory would have been another guess, and the
cost of a fourth round is a day this project does not have with the demo on the
24th.

**What this costs, and it is less than it sounds.** The subject loses the shop
name. Nothing else changes: the message still names the shop, the toy, the
substitute, the price and the collection point, and the body's own hidden preview
line still carries "Same range, R$ 87,99, ready to collect today" into the inbox.
The static line above states the differentiator in seven words, which is what a
Head of CRM reads before opening anything.

**If it is ever worth reopening**, `uc1-subject-nobracket.txt` is the build to try
and one question to Dengage support settles it faster than any more attempts from
this side: what does the Subject field accept, and does it run the content
engine?

**The Pre-header field does not run the template engine, and the Subject field
does.** Proven on 18 August 2026 by pasting the generated file into both: the
subject rendered a real sentence and the pre-header rendered its own source code,
which arrived in the inbox as `Not at ... This one is. - {% function brl(v) { var
n = Number(v); ...`. So `uc1-preheader.txt` is kept only as the generated
counterpart of the subject and **must not be pasted into that field**. The body's
own hidden preview line already does the job, dynamically, at no extra cost,
because the body has resolved the shop by the time it renders.

**No regular expressions anywhere in this block.** The shop shortener first used
four `.replace()` calls with regex literals and returned the name untouched in a
real send: the subject read "Not at Ri Happy Praia de Belas Prime Offices. This
one is." with nothing trimmed. Every other part of the same block worked, so the
engine runs JavaScript but does not apply those replacements. It uses `indexOf`
and `substring` now, which are portable and produce the same result. Treat a
regex in this template as something that will silently do nothing.

Rebuild both files after any change to the body, or the subject silently keeps
resolving the old way.
