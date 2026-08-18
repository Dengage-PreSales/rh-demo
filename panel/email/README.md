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

| Field | Paste | Cost |
|---|---|---|
| Subject | all of `uc1-subject.txt` | one extra resolution per recipient |
| Pre-header | **leave empty** | none. The body's hidden preview line already resolves at no extra cost |

`uc1-preheader.txt` exists for the case where the panel field has to be
populated, and it is the more expensive option: the body has already resolved the
shop by the time it renders its own preview, so filling the field spends a second
resolution to say the same sentence.

Rebuild both files after any change to the body, or the subject silently keeps
resolving the old way.
