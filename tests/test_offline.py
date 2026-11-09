"""Previously sold tickets: preserved numbering, capacity and separate payments.

All fixtures are local. Real guest details never belong in tests or Git.
"""
import concurrent.futures
import json
import os
from pathlib import Path
import secrets
import sqlite3
import time
import unittest
import urllib.parse
import test_tickets as fixtures


@unittest.skipUnless(os.environ.get('STAGING_DB_PATH'), 'Local fixtures not configured')
class OfflineTest(unittest.TestCase):
    request = classmethod(fixtures.TicketTest.request.__func__)
    insert = classmethod(fixtures.TicketTest.insert.__func__)
    event = classmethod(fixtures.TicketTest.event.__func__)
    order = classmethod(fixtures.TicketTest.order.__func__)

    @classmethod
    def setUpClass(cls):
        cls.origin = os.environ['STAGING_ORIGIN'].rstrip('/')
        if urllib.parse.urlparse(cls.origin).hostname not in ('localhost', '127.0.0.1'):
            raise RuntimeError('Local fixtures only')
        cls.db = Path(os.environ['STAGING_DB_PATH']).resolve(strict=True)
        cls.token = cls.admin_cookie = ''
        code, result = cls.request('/api/collections/ticket_staff/auth-with-password', {
            'identity': 'natali', 'password': os.environ['TICKET_STAFF_PASSWORD']})
        if code != 200:
            raise RuntimeError('Login failed')
        cls.token = result['token']
        cls.prefix = 'offline-fixture-' + secrets.token_hex(5)
        cls.events, cls.orders, cls.tickets = [], [], []

    @classmethod
    def tearDownClass(cls):
        with sqlite3.connect(cls.db, timeout=15) as db:
            ids = [r[0] for r in db.execute('SELECT id FROM checkout_events WHERE slug LIKE ?', (cls.prefix+'%',))]
            for event in ids:
                slug = db.execute('SELECT slug FROM checkout_events WHERE id=?', (event,)).fetchone()[0]
                db.execute('DELETE FROM tickets WHERE "order" IN (SELECT id FROM orders WHERE event_id=?)', (slug,))
                db.execute('DELETE FROM orders WHERE event_id=?', (slug,))
                db.execute('DELETE FROM checkout_events WHERE id=?', (event,))

    def payload(self, event):
        return {'event_id': event['slug'], 'capacity': 4, 'guests': [
            {'number': 1, 'name': 'Анна Импорт', 'email': 'import-anna@example.com', 'total': 13500, 'received': 13500, 'method': 'TWINT', 'purchase_date': '2026-10-25'},
            {'number': 18, 'name': 'Мария Импорт', 'email': 'import-maria@example.com', 'total': 15000, 'received': 3500, 'method': 'Наличные', 'purchase_date': '2026-10-26'},
            {'number': 26, 'name': 'Елена Импорт', 'email': 'import-elena@example.com', 'total': 15000, 'received': 15000, 'method': 'Перевод', 'purchase_date': '2026-10-27'}]}

    def test_import_numbers_capacity_and_duplicate_requests(self):
        event = self.event(72); body = self.payload(event)
        self.assertEqual(self.request('/api/events/staff/import-guests', body, headers={'X-Staff-Token': ''})[0], 401)
        self.assertEqual(self.request('/api/events/staff/import-guests', body, headers={'Origin': 'https://example.com'})[0], 403)
        with concurrent.futures.ThreadPoolExecutor(3) as pool:
            results = list(pool.map(lambda _: self.request('/api/events/staff/import-guests', body), range(3)))
        self.assertTrue(all(code == 200 for code, _ in results), results)
        self.assertEqual(sum(data['created'] for _, data in results), 3)
        self.assertTrue(all(data['next_number'] == 27 for _, data in results))
        _, data = self.request('/api/events/staff/tickets?event='+event['slug'])
        self.assertEqual({t['number'] for t in data['items']}, {'001', '018', '026'})
        self.assertEqual((data['paid'], data['reserved'], data['availability']['remaining']), (2, 1, 1))
        self.assertEqual(self.request('/api/events/staff/tickets?event='+event['slug']+'&q=018')[1]['total'], 1)
        self.assertEqual(self.request('/api/events/staff/tickets?event='+event['slug']+'&state=reserved')[1]['total'], 1)
        paid = next(t for t in data['items'] if t['number'] == '001')
        self.assertEqual(self.request('/api/events/staff/refund-ticket', {'event_id': event['slug'], 'ticket_id': paid['id'], 'mode': 'refund'})[0], 400)
        # The regular issuer must continue after the highest imported number.
        order = self.order(event, quantity=1)
        deadline = time.monotonic()+70
        while time.monotonic() < deadline:
            with sqlite3.connect(self.db) as db:
                number = db.execute('SELECT number FROM tickets WHERE "order"=?', (order['id'],)).fetchone()[0]
            if number:
                break
            time.sleep(1)
        self.assertEqual(number, 27)
        _, availability = self.request('/api/events/availability/'+event['slug'])
        self.assertTrue(availability['sold_out'])
        self.assertEqual(availability['remaining'], 0)
        _, csv = self.request('/api/events/staff/guests.csv?event='+event['slug'], raw=True)
        self.assertIn('Ожидает оплаты', csv.decode('utf-8-sig'))
        with sqlite3.connect(self.db) as db:
            flags = db.execute("SELECT receipt_sent,owner_notified FROM orders WHERE event_id=? AND payment_source='offline'", (event['slug'],)).fetchall()
        self.assertEqual(flags, [(1, 1)]*3)

    def test_reserved_ticket_requires_confirmed_payment(self):
        event = self.event(72); body = self.payload(event)
        self.assertEqual(self.request('/api/events/staff/import-guests', body)[0], 200)
        _, data = self.request('/api/events/staff/tickets?event='+event['slug']+'&state=reserved')
        ticket = data['items'][0]; request = {'event_id': event['slug'], 'ticket_id': ticket['id']}
        token = ticket['url'].rsplit('/', 1)[1]
        self.assertEqual(self.request('/api/events/tickets/'+token)[0], 404)
        self.assertEqual(self.request('/api/events/staff/check-in', request)[0], 400)
        self.assertEqual(self.request('/api/events/staff/reminder-preview', request)[0], 400)
        self.assertEqual(self.request('/api/events/staff/confirm-offline-payment', {**request, 'expected_received': 0, 'expected_total': 15000})[0], 400)
        confirm = {**request, 'expected_received': 3500, 'expected_total': 15000}
        self.assertEqual(self.request('/api/events/staff/confirm-offline-payment', confirm)[0], 200)
        self.assertTrue(self.request('/api/events/staff/confirm-offline-payment', confirm)[1]['already_paid'])
        self.assertEqual(self.request('/api/events/tickets/'+token)[0], 200)
        self.assertEqual(self.request('/api/events/staff/check-in', request)[0], 200)
        self.assertEqual(self.request('/api/events/availability/'+event['slug'])[1]['remaining'], 1)

    def test_import_is_atomic_and_never_overwrites(self):
        event = self.event(72); body = self.payload(event)
        too_small = {**body, 'capacity': 2}
        self.assertEqual(self.request('/api/events/staff/import-guests', too_small)[0], 400)
        self.assertEqual(self.request('/api/events/staff/tickets?event='+event['slug'])[1]['total'], 0)
        self.assertEqual(self.request('/api/events/staff/import-guests', body)[0], 200)
        changed = json.loads(json.dumps(body)); changed['guests'][0]['name'] = 'Другое имя'
        self.assertEqual(self.request('/api/events/staff/import-guests', changed)[0], 400)
        duplicate = json.loads(json.dumps(body)); duplicate['guests'][1]['number'] = 1
        self.assertEqual(self.request('/api/events/staff/import-guests', duplicate)[0], 400)

    def test_uncertain_payment_is_not_recorded_as_zero_or_paid(self):
        event = self.event(72); body = self.payload(event)
        body['guests'][0]['received'] = None
        self.assertEqual(self.request('/api/events/staff/import-guests', body)[0], 200)
        ticket = self.request('/api/events/staff/tickets?event='+event['slug']+'&q=001')[1]['items'][0]
        self.assertEqual(ticket['status'], 'reserved')
        self.assertTrue(ticket['offline_received_unknown'])
        _, csv = self.request('/api/events/staff/guests.csv?event='+event['slug'], raw=True)
        self.assertIn('Уточняется', csv.decode('utf-8-sig'))
        request = {'event_id': event['slug'], 'ticket_id': ticket['id'], 'expected_received': 0, 'expected_total': 13500}
        self.assertEqual(self.request('/api/events/staff/confirm-offline-payment', request)[0], 400)
        self.assertEqual(self.request('/api/events/staff/confirm-offline-payment', {**request, 'expected_received_unknown': True})[0], 200)
        ticket = self.request('/api/events/staff/tickets?event='+event['slug']+'&q=001')[1]['items'][0]
        self.assertEqual((ticket['status'], ticket['offline_received']), ('paid', 13500))
        self.assertFalse(ticket['offline_received_unknown'])

    def test_archiving_keeps_old_tests_and_replay_keeps_new_sales(self):
        event = self.event(72); old = self.order(event, quantity=1)
        body = {**self.payload(event), 'archive_sandbox_orders': True}
        code, result = self.request('/api/events/staff/import-guests', body)
        self.assertEqual(code, 200, result); self.assertEqual(result['archived_orders'], 1)
        with sqlite3.connect(self.db) as db:
            archived_slug = db.execute('SELECT event_id FROM orders WHERE id=?', (old['id'],)).fetchone()[0]
        self.assertNotEqual(archived_slug, event['slug'])
        self.assertEqual(self.request('/api/events/tickets/'+old['tickets'][0]['token'])[0], 200)
        new = self.order(event, quantity=1)
        code, replay = self.request('/api/events/staff/import-guests', body)
        self.assertEqual((code, replay['archived_orders'], replay['unchanged']), (200, 0, 3))
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT event_id FROM orders WHERE id=?', (new['id'],)).fetchone()[0], event['slug'])
