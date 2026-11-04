"""Sandbox integration checks. Requires a running isolated staging instance.
STAGING_ORIGIN, STAGING_PASSWORD and STRIPE_WEBHOOK_SECRET must be set.
Creates only unpaid test Checkout sessions, using example.com contact details.
"""
import base64
import concurrent.futures
import hashlib
import hmac
import json
import os
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
import uuid


class CheckoutTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.origin = os.environ['STAGING_ORIGIN'].rstrip('/')
        host = urllib.parse.urlparse(cls.origin).hostname
        if host not in ('localhost', '127.0.0.1') and 'staging' not in (host or ''):
            raise RuntimeError('Refusing to test a non-staging origin')
        cls.auth = 'Basic ' + base64.b64encode(('preview:' + os.environ['STAGING_PASSWORD']).encode()).decode()

    def request(self, path, body=None, headers=None):
        hdr = {'Authorization': self.auth, 'Origin': self.origin, 'Content-Type': 'application/json'}
        hdr.update(headers or {})
        req = urllib.request.Request(self.origin + path, data=json.dumps(body).encode() if body is not None else None, headers=hdr)
        try:
            with urllib.request.urlopen(req, timeout=40) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read() or '{}')

    def booking(self, **changes):
        return dict(event_id='refresh-2-0', name='Staging Test', email='checkout@example.com',
                    phone='', message='', quantity=2, language='ru', newsletter_opt_in=False,
                    guests=[{'name':'Анна Проверка','email':'anna@example.com','wishes':'Без орехов'}, {'name':'Мария Проверка','email':'','wishes':''}],
                    checkout_key=str(uuid.uuid4()), **changes)

    def test_retries_and_client_price_are_safe(self):
        booking = self.booking(price='0.01', status='paid')
        status, session = self.request('/api/events/checkout', booking)
        self.assertEqual(status, 200, session)
        self.assertTrue(session['url'].startswith('https://checkout.stripe.com/c/pay/cs_test_'))
        with concurrent.futures.ThreadPoolExecutor(3) as pool:
            retries = list(pool.map(lambda _: self.request('/api/events/checkout', booking), range(3)))
        self.assertTrue(all(status == 200 and result['url'] == session['url'] for status, result in retries))
        status, order = self.request('/api/events/checkout/' + booking['checkout_key'])
        self.assertEqual((status, order['status'], order['amount'], order['currency']), (200, 'pending', 30000, 'chf'))
        status, _ = self.request('/api/events/checkout', {**booking, 'quantity': 1})
        self.assertEqual(status, 400)

    def test_invalid_orders_and_cross_origin(self):
        booking = self.booking()
        for changes in ({'quantity': 0}, {'quantity': 11}, {'quantity': 1.5}, {'event_id': 'missing'}, {'email': 'bad'}, {'checkout_key': 'short'}, {'guests': []}, {'guests': [{'name':'','email':'bad'}]*2}):
            with self.subTest(changes=changes):
                self.assertEqual(self.request('/api/events/checkout', {**booking, **changes})[0], 400)
        self.assertEqual(self.request('/api/events/checkout', booking, {'Origin': 'https://example.com'})[0], 403)
        self.assertEqual(self.request('/api/collections/orders/records', booking)[0], 403)

    def test_signature_and_timestamp(self):
        secret = os.environ['STRIPE_WEBHOOK_SECRET']
        body = {'livemode': False, 'type': 'ignored.test'}
        raw = json.dumps(body)
        def signature(timestamp, text=raw):
            digest = hmac.new(secret.encode(), (str(timestamp) + '.' + text).encode(), hashlib.sha256).hexdigest()
            return {'Stripe-Signature': 't=' + str(timestamp) + ',v1=' + digest}
        now = int(time.time())
        self.assertEqual(self.request('/api/events/stripe-webhook', body, signature(now))[0], 200)
        self.assertEqual(self.request('/api/events/stripe-webhook', body, signature(now - 600))[0], 400)
        self.assertEqual(self.request('/api/events/stripe-webhook', body, signature(now, 'tampered'))[0], 400)
        live = {'livemode': True, 'type': 'ignored.test'}
        self.assertEqual(self.request('/api/events/stripe-webhook', live, signature(now, json.dumps(live)))[0], 400)


if __name__ == '__main__':
    unittest.main()
