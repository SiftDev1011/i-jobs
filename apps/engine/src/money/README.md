# Communities and money

## The rules (all settings; change them in `.env`, not code)

| Rule | Setting | Default |
|---|---|---|
| Lowest price an owner can set | `MINIMUM_PRICE_KOBO` | ₦5,000 |
| i-jobs' share of each payment | `PLATFORM_SHARE_BPS` | 20% (stored per community when it's created) |
| Membership periods | `billing_period` per community | monthly 30 days, quarterly 90, yearly 365 |
| Free trial | owner's choice, `TRIAL_DAYS`; only when texts are on (`SMS_DRIVER` not `none`) | 7 days, once per person (phone, card) |
| Access after a missed renewal | `GRACE_DAYS` | 3 days (none if the community was banned) |
| Payouts | `PAYOUT_HOLD_DAYS`, `PAYOUT_MINIMUM_KOBO` | monthly, money at least 7 days old, from ₦5,000 |
| Selar codes | per batch | owner prepays our share per code; each code = one period; never expire; non-refundable |

Prices only appear on the owner pages and the join page (the payment step). Search and public pages
never show them.

## Paying

`POST /memberships/{id}/checkout` (needs an `Idempotency-Key`) creates a pending payment and a Paga
payment request; the member pays on Paga's page. Paga calls `/v1/hooks/paga`. The callback's hash
is checked (SHA-512 of notificationId + statusCode + externalReferenceNumber + state +
outstandingBalance + hash key), and only a pending payment can succeed, once. Then:

- **Membership:** active; the period starts when the current one (or the trial) ends, so paying
  early never loses days. Ledger: cash +100%, i-jobs −20%, owner −80%.
- **Code batch:** the codes are created (`LTH-7K4P9QXA`), downloadable as CSV for Selar. Ledger:
  cash +100%, i-jobs −100%.

Unused payment links fail after 7 days.

**Demo payments.** With `PAGA_DRIVER=fake` (development and demos; refused in production) the
checkout link is the web app's `/demo-pay/<payment id>` page. Its button calls
`POST /v1/dev/demo-payments/{id}/complete`, which sends a correctly signed success callback through the
same code as a real payment. `GET /v1/features` says `demo_payments: true` so apps know.

**Before going live, in Paga's sandbox (`PAGA_BASE_URL=https://beta-collect.paga.com`):** the docs
don't say which key is the Basic-auth user (we send `publicKey:secretKey`) or how empty optional
fields enter the request hash (we use empty strings). Make one test payment end to end; if Paga
refuses the request, those two lines in `paga.ts` are the place to look.

## The ledger

Double entry, debits positive and credits negative, every event adding to zero (`ledger_unbalanced`
must always be empty). `owner_balances` shows what we owe each community, as a positive number.

## Payouts

1st of each month, 09:00 Lagos: one payout per community whose settled balance (money older than 7
days, minus payouts already in progress) is at least ₦5,000. During the beta a person sends each one:

1. `POST /admin/payouts/{id}/release` checks the owner's identity and bank account are verified, the
   community has no open fraud review, and the hold has passed.
2. Finance sends the transfer from Paga's business account to the owner's verified bank account.
3. `POST /admin/payouts/{id}/paid` with the transfer reference. Only now does the ledger move the money.

Automatic transfers through Paga's business API can replace step 2 once the flow is proven.

## Bans

`POST /admin/communities/{id}/ban`: unused codes are voided and unsent payouts frozen (a database
trigger), the owner's identity is banned (they can't return under a new name: ID and bank account
are checked), people waiting to join are cancelled. Paying members keep access to the end of what
they paid for, then see a switch offer.

## Fraud checks (daily, a person decides)

One card paying for four or more accounts; communities where 70%+ of 10+ paid members never set
anything up after two weeks (possibly memberships bought by the owner); three or more refunds or
reversals in 30 days. Trial reuse is caught when it happens. Underpayments are flagged. An open
signal blocks that community's payouts.

## Not yet

- Refunds: the ledger function exists (`recordRefund`); the policy and endpoint wait for your decision.
- Flyer images for pasted jobs: text only for now.
- Automatic payout transfers (see above).
