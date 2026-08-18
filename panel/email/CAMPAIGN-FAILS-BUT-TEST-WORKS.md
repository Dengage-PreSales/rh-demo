# The campaign errors, the test send does not

Written 18 August 2026 after exactly that. The panel reports an error and does
not say what it was, which is the whole difficulty, so this is both the cause we
found and the method for finding the next one.

---

## The principle, which is most of the answer

**A preview and a test send run one contact that you chose. A campaign runs every
contact in the segment.** So the template is not being tested by your test send:
one path through it is. Any contact whose data takes a different path is
unexercised until the campaign runs, and the first one that throws takes the run
down.

Ask, every time: **which contact in this segment is different from the one I
tested with?** Usually it is the one with nothing. No shop, no page view, no
device, no product.

---

## What it actually was, this time

```js
if (!d || !d.storeName) { $blockSend(); }

var hero = d.hero || null;      // d is null here
```

`d` is dereferenced on the line after the one that decided it was null. That is
only safe if `$blockSend()` halts execution immediately, and nothing documents
that it does. A template is a function that returns a string, so the likeliest
behaviour is that `$blockSend` marks the send and **returns**, and then `d.hero`
throws "cannot read property of null".

It matches the symptom exactly. Every preview and every test send picked a
contact whose shop resolved, so `d` was never null and that line never ran with
null in it. A campaign runs the whole segment, and the first contact whose shop
cannot be resolved hits it.

**Two rules out of one bug:**

1. **Never assume `$blockSend` stops anything.** Everything after it must run to
   completion without throwing. Set safe values and carry on.
2. **`$blockSend` is called through `typeof $blockSend === 'function'`.** It had
   never once run in a real send here, because no test ever chose a contact that
   blocks, so whether it exists in this account is still unverified. An undefined
   function called directly is a ReferenceError and fails identically.

---

## The ladder, when it is not that

Five launches, each a real campaign to a **segment of one contact who reproduces
the failure**. The first one that errors names the layer. Each is small enough
to paste into the Code Editor whole.

**1. No script at all.** Proves the campaign, segment, journey and sending
domain are fine and the fault is in the content.

```html
<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head>
<body>Probe 1: static only.</body></html>
```

**2. Contact substitution.**

```
{% var k = ''; try { k = String($Contact.contact_key || ''); } catch (e) {} %}
Probe 2: key is [{%= k %}]
```

**3. One `$from` read.** The Star Schema walk, which is the part most likely to
behave differently per contact.

```
{% var n = 0; try { var L = $from('$db.master_device').where('contact_key','=',String($Contact.contact_key||'')).take(50).get(); n = L ? L.length : -1; } catch (e) { n = -2; } %}
Probe 3: devices [{%= n %}]
```

`-1` means the query answered nothing, `-2` means it threw. A large number here
is itself a finding: see the volume note below.

**4. The endpoint.**

```
{% var r = ''; try { r = String($CustomApi.rh_email('01310100','100184971','1')).substring(0,60); } catch (e) { r = 'threw: ' + e.message; } %}
Probe 4: endpoint says [{%= r %}]
```

**5. The full template.** If 1 to 4 pass and 5 fails, the fault is in the logic
between them, and the fastest next move is to comment the template down by
halves rather than reason about it.

---

## The other suspects, in the order I would check them

**Query volume per recipient.** The template reads up to 50 devices and then up
to two page view queries per device. That is up to 101 reads for one email. A
test send does it once. A campaign does it per contact, and a per-render limit or
a timeout would look exactly like an unexplained error. If probe 3 reports a
large number, lower `DEVICE_LIMIT` and try again. The cost of lowering it is in
`JOURNEY-UC1.md`: a truncated device list can resolve the wrong city, so the
template says `CAPPED` in its footer when it happens.

**`rh_store_offer` may not exist.** The template calls it whenever
`$Contact.nearest_store` is set. That column is null on every contact tested, so
this path has never run, and whether the endpoint was ever created in the panel
is unconfirmed. It is inside a try/catch, so it should degrade rather than throw,
but confirm the endpoint exists before trusting that.

**Contacts that cannot be mailed.** A segment will select a contact with no email
address or with `email_permission` off. That is not a content error and usually
reports differently, but it is worth excluding early because it costs one look.

---

## What would have caught this before the launch

`tools/render-email.mjs` runs nine cases, and one of them is Vitoria, where no
shop resolves. It reported BLOCKED and passed, because the harness models
`$blockSend` as throwing, which stops the renderer at the same line the panel
would have carried on past.

**The harness modelled the behaviour we hoped for rather than the one we had not
checked.** That is the same failure this repository has already recorded twice,
in `render-email.mjs` itself: a renderer that mirrors the template's happy path
proves the happy path and nothing else. If `$blockSend` had been stubbed as a
no-op as well as a throw, the null dereference would have surfaced in a second.
