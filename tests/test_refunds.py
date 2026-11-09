"""Per-guest refunds against Stripe Sandbox and a disposable local database.

Needs the ticket-test environment plus STRIPE_SECRET_KEY (sk_test_ only).
No real money or remote database writes. Provider lifecycle tests may take minutes.
"""
import concurrent.futures
import csv
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import secrets
import sqlite3
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

import test_tickets as fixtures


@unittest.skipUnless(os.environ.get('STAGING_DB_PATH') and os.environ.get('STRIPE_SECRET_KEY'),
                     'Local Stripe Sandbox refund fixtures not configured')
class RefundTest(unittest.TestCase):
    insert = classmethod(fixtures.TicketTest.insert.__func__)
    event = classmethod(fixtures.TicketTest.event.__func__)
    order = classmethod(fixtures.TicketTest.order.__func__)

    @classmethod
    def setUpClass(cls):
        cls.origin = os.environ['STAGING_ORIGIN'].rstrip('/')
        if urllib.parse.urlparse(cls.origin).hostname not in ('localhost', '127.0.0.1'):
            raise RuntimeError('Refund fixtures are local-only')
        cls.key = os.environ['STRIPE_SECRET_KEY']
        if not cls.key.startswith('sk_test_'):
            raise RuntimeError('Stripe Sandbox key required')
        cls.db = Path(os.environ['STAGING_DB_PATH']).resolve(strict=True)
        if not str(cls.db).startswith('/tmp/') and '/staging/data/' not in str(cls.db):
            raise RuntimeError('Expected an isolated staging database')
        cls.token = ''; cls.admin_cookie = ''
        code, data = cls.request('/api/collections/ticket_staff/auth-with-password',
                                {'identity': 'natali', 'password': os.environ['TICKET_STAFF_PASSWORD']})
        if code != 200: raise RuntimeError('Staff login failed')
        cls.token = data['token']
        code, data = cls.request('/api/collections/_superusers/auth-with-password', {
            'identity': os.environ.get('STAGING_ADMIN_EMAIL', 'natali@events-luzern.test'),
            'password': os.environ['TICKET_STAFF_PASSWORD']})
        if code != 200: raise RuntimeError('Admin login failed')
        cls.admin_cookie = 'pb_auth=' + data['token']
        cls.prefix = 'refund-fixture-' + secrets.token_hex(5)
        cls.events, cls.orders, cls.tickets = [], [], []
        # Start real asynchronous provider cases first while the other tests run.
        cls.pending_order = cls.paid('pm_card_pendingRefund')
        cls.failed_order = cls.paid('pm_card_refundFail')
        cls.lifecycle = []
        for order in (cls.pending_order, cls.failed_order):
            code, data = cls.refund(order)
            if code != 200: raise RuntimeError('Starting asynchronous Sandbox refund failed: ' + str(data))
            cls.lifecycle.append(data['refund']['status'])

    @classmethod
    def tearDownClass(cls):
        with sqlite3.connect(cls.db, timeout=15) as db:
            for table in ('ticket_refunds', 'tickets'):
                db.executemany('DELETE FROM ' + table + ' WHERE "order"=?', [(id,) for id in cls.orders])
            for table, ids in [('orders', cls.orders), ('checkout_events', cls.events)]:
                db.executemany('DELETE FROM ' + table + ' WHERE id=?', [(id,) for id in ids])

    @classmethod
    def request(cls, path, body=None, method=None, headers=None, raw=False):
        hdr = {'Origin': cls.origin, 'X-Staff-Token': cls.token, 'Content-Type': 'application/json'}
        if path.startswith('/mail/'): hdr['Cookie'] = cls.admin_cookie
        hdr.update(headers or {})
        req = urllib.request.Request(cls.origin + path, data=json.dumps(body).encode() if body is not None else None,
                                     headers=hdr, method=method)
        try: response = urllib.request.urlopen(req, timeout=45)
        except urllib.error.HTTPError as error: response = error
        with response:
            data = response.read()
            return response.status, data if raw else json.loads(data or '{}')

    @classmethod
    def stripe(cls, path, data=None):
        req = urllib.request.Request('https://api.stripe.com/v1/' + path,
            data=urllib.parse.urlencode(data).encode() if data is not None else None,
            headers={'Authorization': 'Bearer ' + cls.key, 'Stripe-Version': '2025-02-24.acacia'})
        with urllib.request.urlopen(req, timeout=40) as response: return json.load(response)

    @classmethod
    def paid(cls, payment_method='pm_card_visa', quantity=2):
        event = cls.event(72)
        order = cls.order(event, quantity=quantity)
        intent = cls.stripe('payment_intents', {'amount': 15000 * quantity, 'currency': 'chf',
            'payment_method_types[0]': 'card', 'payment_method': payment_method, 'confirm': 'true',
            'metadata[order_id]': order['id']})
        if intent['livemode'] or intent['status'] != 'succeeded': raise RuntimeError('Expected paid Sandbox intent')
        with sqlite3.connect(cls.db, timeout=15) as db:
            db.execute('UPDATE orders SET stripe_payment_intent=? WHERE id=?', (intent['id'], order['id']))
            db.execute('UPDATE checkout_events SET capacity=?,ticket_sequence=? WHERE id=?', (quantity, quantity, event['id']))
            db.execute('UPDATE tickets SET number=position,event_id=? WHERE "order"=?', (event['slug'], order['id']))
        order['intent'] = intent
        return order

    @classmethod
    def body(cls, order, index=0):
        return {'event_id': order['event']['slug'], 'ticket_id': order['tickets'][index]['id']}

    @classmethod
    def refund(cls, order, index=0, **changes):
        return cls.request('/api/events/staff/refund-ticket', {**cls.body(order, index), 'mode': 'refund', **changes})

    @classmethod
    def options(cls, order, index=0):
        return cls.request('/api/events/staff/refund-options?' + urllib.parse.urlencode(cls.body(order, index)))

    def webhook(self, order, event_type='charge.refunded', **old_fields):
        obj = {'id': order['intent']['latest_charge']} if event_type == 'charge.refunded' else {'id': 're_old', 'charge': order['intent']['latest_charge']}
        body = {'livemode': False, 'type': event_type, 'data': {'object': {**obj, **old_fields}}}
        raw = json.dumps(body); now = int(time.time())
        sig = hmac.new(os.environ['STRIPE_WEBHOOK_SECRET'].encode(), (str(now) + '.' + raw).encode(), hashlib.sha256).hexdigest()
        return self.request('/api/events/stripe-webhook', body, headers={'Stripe-Signature': 't=' + str(now) + ',v1=' + sig})

    def assert_admission(self, order, index, valid):
        ticket = order['tickets'][index]; path = '/api/events/tickets/' + ticket['token']
        code, data = self.request(path)
        self.assertEqual(code, 200, data)
        self.assertEqual(data['status'] != 'refunded', valid)
        self.assertEqual(self.request(path + '/qr.gif', raw=True)[0], 200 if valid else 410)
        self.assertEqual(self.request(path + '/calendar.ics', raw=True)[0], 200 if valid else 410)
        self.assertEqual(self.request('/api/events/staff/check-in', self.body(order, index))[0], 200 if valid else 400)

    def test_single_ticket_refund_and_concurrent_retries(self):
        order = self.paid()
        self.assertEqual(self.request('/api/events/availability/' + order['event']['slug'])[1]['sold_out'], True)
        with concurrent.futures.ThreadPoolExecutor(3) as pool:
            results = list(pool.map(lambda _: self.refund(order, 1), range(3)))
        self.assertTrue(all(code in (200, 502) for code, _ in results), results)
        self.assertTrue(any(code == 200 for code, _ in results), results)
        self.assertTrue(all(result['refund']['status'] == 'succeeded' for code, result in results if code == 200), results)
        code, retry = self.refund(order, 1)
        self.assertEqual((code, retry['already_refunded'], retry['refund']['status']), (200, True, 'succeeded'))
        refunds = self.stripe('refunds?' + urllib.parse.urlencode({'payment_intent': order['intent']['id']}))['data']
        self.assertEqual([(r['amount'], r['status']) for r in refunds], [(15000, 'succeeded')])
        self.assert_admission(order, 1, False); self.assert_admission(order, 0, True)
        self.assertEqual(self.request('/api/events/staff/reminder-preview', {'ticket_id': order['tickets'][1]['id']})[0], 400)
        _, data = self.request('/api/events/staff/tickets?event=' + order['event']['slug'])
        self.assertEqual((data['paid'], data['arrived'], data['availability']['remaining']), (1, 1, 1))
        self.assertFalse(data['availability']['sold_out'])
        for state, expected in [('refunded', 1), ('arrived', 1), ('waiting', 0)]:
            _, filtered = self.request('/api/events/staff/tickets?' + urllib.parse.urlencode({'event': order['event']['slug'], 'state': state}))
            self.assertEqual((filtered['total'], len(filtered['items'])), (expected, expected))
        _, content = self.request('/api/events/staff/guests.csv?event=' + order['event']['slug'], raw=True)
        rows = list(csv.DictReader(io.StringIO(content.decode('utf-8-sig')), delimiter=';'))
        self.assertEqual([row['Статус билета'] for row in rows], ['Действует', 'Возвращено — билет недействителен'])
        self.assertEqual([row['Возвращено за билет'] for row in rows], ['0.00', '150.00'])
        self.assertEqual([row['Билет'] for row in rows], ['№ 001', '№ 002'])
        # Replayed, stale webhook payloads must fetch actual Stripe state.
        self.assertEqual(self.webhook(order, 'refund.failed', status='failed')[0], 200)
        self.assert_admission(order, 1, False)
        self.assertEqual(self.refund(order, 0)[0], 200)
        self.assert_admission(order, 0, False)
        _, data = self.request('/api/events/staff/tickets?event=' + order['event']['slug'])
        self.assertEqual((data['paid'], data['arrived'], data['availability']['remaining']), (0, 0, 2))

    def test_external_refund_maps_once_without_returning_money_again(self):
        order = self.paid(quantity=3)
        external = self.stripe('refunds', {'payment_intent': order['intent']['id'], 'amount': 15000})
        self.assertEqual(self.webhook(order)[0], 200)
        code, options = self.options(order)
        self.assertEqual((code, options['unassigned_amount'], options['can_refund']), (200, 15000, False))
        self.assertEqual(len(options['existing']), 1)
        self.assertEqual(self.refund(order)[0], 400)  # Must use money already returned.
        refund_id = options['existing'][0]['id']
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda i: self.refund(order, i, mode='existing', refund_id=refund_id), (0, 1)))
        self.assertEqual(sorted(code for code, _ in results), [200, 400], results)
        chosen = next(i for i, (code, _) in enumerate(results) if code == 200)
        self.assert_admission(order, chosen, False); self.assert_admission(order, 1-chosen, True)
        refunds = self.stripe('refunds?payment_intent=' + order['intent']['id'])['data']
        self.assertEqual([r['id'] for r in refunds], [external['id']])
        self.stripe('refunds', {'payment_intent': order['intent']['id']})  # Remaining full refund.
        self.assertEqual(self.webhook(order)[0], 200)
        for i in range(3): self.assert_admission(order, i, False)

    def test_recover_provider_success_before_response_and_old_unresolved_request(self):
        order = self.paid(); rid = secrets.token_hex(7) + 'r'; key = 'refund-fixture-' + secrets.token_hex(16)
        created = (datetime.now(timezone.utc)-timedelta(hours=25)).strftime('%Y-%m-%d %H:%M:%S.000Z')
        self.insert('ticket_refunds', {'id': rid, 'order': order['id'], 'ticket_ids': json.dumps([order['tickets'][0]['id']]),
            'amount': 15000, 'currency': 'chf', 'status': 'requesting', 'source': 'admin', 'idempotency_key': key, 'created': created})
        with sqlite3.connect(self.db, timeout=15) as db:
            db.execute("UPDATE tickets SET refund_request=?,refund_state='requesting' WHERE id=?", (rid, order['tickets'][0]['id']))
        code, error = self.refund(order)
        self.assertEqual((code, error['message'].rstrip('.')), (400, 'Refund needs reconciliation'))
        self.assertEqual(self.stripe('refunds?payment_intent=' + order['intent']['id'])['data'], [])
        # Emulate a lost response: the provider accepted it, the local row is still requesting.
        external = self.stripe('refunds', {'payment_intent': order['intent']['id'], 'amount': 15000,
            'metadata[ticket_refund_id]': rid, 'metadata[order_id]': order['id']})
        code, result = self.refund(order)
        self.assertEqual((code, result['already_refunded']), (200, True))
        self.assert_admission(order, 0, False); self.assert_admission(order, 1, True)
        self.assertEqual([r['id'] for r in self.stripe('refunds?payment_intent=' + order['intent']['id'])['data']], [external['id']])

    def test_authorization_and_order_boundaries(self):
        order = self.paid(); body = {**self.body(order), 'mode': 'refund'}
        for headers, status in [({'X-Staff-Token': ''}, 401), ({'Origin': 'https://example.com'}, 403)]:
            self.assertEqual(self.request('/api/events/staff/refund-ticket', body, headers=headers)[0], status)
        self.assertEqual(self.request('/api/events/staff/refund-options?' + urllib.parse.urlencode(self.body(order)), headers={'X-Staff-Token': ''})[0], 401)
        self.assertEqual(self.request('/api/collections/ticket_refunds/records')[0], 403)
        self.assertEqual(self.refund(order, event_id='wrong-event')[0], 400)
        self.assertEqual(self.refund(order, mode='unknown')[0], 400)
        self.assertEqual(self.refund(order, mode='existing', refund_id='missing')[0], 400)
        self.options(self.pending_order)
        with sqlite3.connect(self.db, timeout=15) as db:
            rid = db.execute('SELECT id FROM ticket_refunds WHERE "order"=? LIMIT 1', (self.pending_order['id'],)).fetchone()[0]
        self.assertEqual(self.refund(order, mode='existing', refund_id=rid)[0], 400)
        unpaid = self.order(order['event'], status='pending')
        self.assertEqual(self.refund(unpaid)[0], 400)
        self.assertEqual(self.stripe('refunds?payment_intent=' + order['intent']['id'])['data'], [])

    def test_reminders_only_include_remaining_guests(self):
        order = self.paid(); self.assertEqual(self.refund(order, 1)[0], 200)
        with sqlite3.connect(self.db, timeout=15) as db:
            starts = (datetime.now(timezone.utc)+timedelta(hours=23)).isoformat()
            event = {**order['event'], 'starts_at': starts, 'details': json.loads(order['event']['details'])}
            old = (datetime.now(timezone.utc)-timedelta(days=2)).isoformat()
            db.execute('UPDATE checkout_events SET starts_at=? WHERE id=?', (starts, order['event']['id']))
            db.execute('UPDATE orders SET event_snapshot=?,created=? WHERE id=?', (json.dumps(event), old, order['id']))
        deadline = time.monotonic()+100; found = []
        while time.monotonic() < deadline:
            _, inbox = self.request('/mail/api/v1/messages?limit=1000')
            found = [m for m in inbox['messages'] if order['event']['name'] in m['Subject']]
            if found: break
            time.sleep(2)
        self.assertEqual(len(found), 1, [(m['To'], m['Subject']) for m in found])
        self.assertEqual(found[0]['To'][0]['Address'], order['email'])
        _, mail = self.request('/mail/api/v1/message/'+found[0]['ID'])
        self.assertIn('Гость 1', mail['Text']); self.assertNotIn('Гость 2', mail['Text'])
        self.assertEqual(mail['HTML'].count('class="event-ticket"'), 1)
        with sqlite3.connect(self.db, timeout=15) as db:
            self.assertEqual(db.execute('SELECT reminder_sent FROM tickets WHERE id=?', (order['tickets'][1]['id'],)).fetchone()[0], 0)

    def test_z_asynchronous_success_and_bank_failure(self):
        self.assertEqual(self.lifecycle, ['pending', 'succeeded'])
        # Stripe's test methods settle asynchronously; don't fake provider success/failure.
        deadline = time.monotonic()+480
        while time.monotonic() < deadline:
            _, pending = self.options(self.pending_order)
            _, failed = self.options(self.failed_order)
            if pending['status'] == 'succeeded' and failed['status'] == 'failed': break
            time.sleep(10)
        self.assertEqual((pending['status'], failed['status']), ('succeeded', 'failed'))
        self.assert_admission(self.pending_order, 0, False); self.assert_admission(self.pending_order, 1, True)
        self.assert_admission(self.failed_order, 0, True); self.assert_admission(self.failed_order, 1, True)
        _, availability = self.request('/api/events/availability/' + self.failed_order['event']['slug'])
        self.assertEqual((availability['paid'], availability['remaining']), (2, 0))
        self.assertTrue(failed['can_refund'])


if __name__ == '__main__':
    unittest.main()
