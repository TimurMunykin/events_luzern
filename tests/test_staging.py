"""Full application contracts on the isolated staging environment."""
import json
import os
from pathlib import Path
import unittest
import urllib.error
import urllib.parse
import urllib.request
import uuid


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class StagingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.origin = os.environ['STAGING_ORIGIN'].rstrip('/')
        host = urllib.parse.urlparse(cls.origin).hostname or ''
        if host not in ('localhost', '127.0.0.1') and 'staging' not in host:
            raise RuntimeError('Refusing to test production')
        cls.token = ''
        status, data = cls.request('/api/collections/_superusers/auth-with-password', {
            'identity': os.environ.get('STAGING_ADMIN_EMAIL', 'natali@events-luzern.test'),
            'password': os.environ['TICKET_STAFF_PASSWORD']})
        if status != 200:
            raise RuntimeError('Staging admin login failed')
        cls.token = data['token']

    @classmethod
    def request(cls, path, body=None, method=None, headers=None, raw=False):
        hdr = {'Authorization': cls.token, 'Origin': cls.origin, 'Content-Type': 'application/json'}
        hdr.update(headers or {})
        req = urllib.request.Request(cls.origin+path, data=json.dumps(body).encode() if body is not None else None,
                                     method=method, headers=hdr)
        try:
            response = urllib.request.urlopen(req, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            data = response.read()
            return response.status, data if raw else json.loads(data or '{}')

    def test_full_site_and_existing_admin_share_one_login(self):
        status, html = self.request('/', headers={'Authorization': ''}, raw=True)
        self.assertEqual(status, 200)
        self.assertEqual(html, (Path(__file__).resolve().parents[1]/'prototypes/aurora-v22d.html').read_bytes())
        for path, marker in [('/admin/', b'data-route="guests"'), ('/prototypes/', b'Events.Luzern'), ('/mail/', b'Mailpit')]:
            status, html = self.request(path, headers={'Authorization': '', 'Cookie': 'pb_auth='+self.token}, raw=True)
            self.assertEqual(status, 200)
            self.assertIn(marker, html)
        status, inbox = self.request('/mail/api/v1/messages', headers={'Cookie': 'pb_auth='+self.token})
        self.assertEqual(status, 200)
        self.assertIsInstance(inbox['messages'], list)
        for collection in ('requests', 'payment_settings', 'site_config'):
            self.assertEqual(self.request('/api/collections/'+collection+'/records?perPage=1')[0], 200)
        self.assertEqual(self.request('/api/events/staff/events')[0], 200)
        self.assertEqual(self.request('/api/events/staff/events', headers={'Authorization': ''})[0], 401)

    def test_public_site_and_normal_login_for_private_pages(self):
        for path in ('/', '/login', '/assets/logo.png'):
            with urllib.request.urlopen(self.origin+path, timeout=20) as response:
                self.assertEqual(response.status, 200)
                self.assertIsNone(response.headers.get('WWW-Authenticate'))
        opener = urllib.request.build_opener(NoRedirect)
        for cookie in ('', 'pb_auth=expired-token'):
            for path in ('/admin/', '/prototypes/', '/mail/', '/mail/api/v1/messages'):
                req = urllib.request.Request(self.origin+path, headers={'Cookie': cookie})
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    opener.open(req, timeout=20)
                response = caught.exception
                self.assertEqual(response.code, 302)
                self.assertEqual(response.headers['Location'], '/login?next='+urllib.parse.quote(path, safe=''))
                self.assertIsNone(response.headers.get('WWW-Authenticate'))
                response.close()
        status, html = self.request('/admin/', headers={'Authorization': ''}, raw=True)
        self.assertEqual(status, 200)  # Redirected to the existing login.
        self.assertIn(b'auth-with-password', html)
        status, staff = self.request('/api/collections/ticket_staff/auth-with-password', {
            'identity': 'natali', 'password': os.environ['TICKET_STAFF_PASSWORD']})
        self.assertEqual(status, 200)
        for path in ('/admin/', '/prototypes/', '/mail/', '/mail/api/v1/messages'):
            status, html = self.request(path, headers={
                'Authorization': '', 'Cookie': 'pb_auth='+staff['token']}, raw=True)
            self.assertIn(b'auth-with-password', html)  # Limited staff cannot access the full admin or inbox.
        for collection in ('orders', 'tickets', 'checkout_events'):
            status, data = self.request('/api/collections/'+collection+'/records', headers={'Authorization': ''})
            self.assertEqual(status, 403)
        status, settings = self.request('/api/settings')
        self.assertEqual(status, 200)
        self.assertEqual(settings['smtp']['host'], 'mailpit')
        self.assertEqual(settings['meta']['appURL'], self.origin)

    def test_existing_forms_reach_existing_admin(self):
        for kind in ('ticket', 'resident', 'speaker', 'partner'):
            with self.subTest(kind=kind):
                marker = 'Staging form test '+uuid.uuid4().hex[:8]
                status, item = self.request('/api/collections/requests/records', {
                    'request_type': kind, 'name': marker, 'email': 'form-test@example.com',
                    'language': 'ru', 'status': 'new', 'event_name': '[ТЕСТ] RE:FRESH 2.0',
                    'event_date': '15.11.2026', 'tickets_count': '1', 'price': 'CHF 150',
                    'message': 'Тест существующей формы в staging'}, headers={'Authorization': ''})
                self.assertEqual(status, 200, item)
                try:
                    status, found = self.request('/api/collections/requests/records/'+item['id'])
                    self.assertEqual((status, found['name'], found['request_type']), (200, marker, kind))
                finally:
                    self.assertEqual(self.request('/api/collections/requests/records/'+item['id'], method='DELETE')[0], 204)


if __name__ == '__main__':
    unittest.main()
