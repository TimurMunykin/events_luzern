"""Local-only ticket integration fixtures; never writes to a remote database.

Needs STAGING_ORIGIN, TICKET_STAFF_PASSWORD and STAGING_DB_PATH.
Uses disposable records in the isolated SQLite database to exercise reminders
without changing the system clock. Actual Stripe payment is tested separately.
Optional QR/calendar checks require zxing-cpp, Pillow and icalendar.
"""
import concurrent.futures
from datetime import datetime, timedelta, timezone
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


@unittest.skipUnless(os.environ.get('STAGING_DB_PATH'), 'Local ticket fixtures not configured')
class TicketTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.origin = os.environ['STAGING_ORIGIN'].rstrip('/')
        if urllib.parse.urlparse(cls.origin).hostname not in ('localhost', '127.0.0.1'):
            raise RuntimeError('Ticket fixtures are local-only')
        cls.db = Path(os.environ['STAGING_DB_PATH']).resolve(strict=True)
        if '/staging/data/' not in str(cls.db) and not str(cls.db).startswith('/tmp/'):
            raise RuntimeError('Expected an isolated staging database')
        cls.token = ''
        cls.admin_cookie = ''
        status, data = cls.request('/api/collections/ticket_staff/auth-with-password',
                                  {'identity': 'natali', 'password': os.environ['TICKET_STAFF_PASSWORD']})
        if status != 200:
            raise RuntimeError('Staff login failed')
        cls.token = data['token']
        status, admin = cls.request('/api/collections/_superusers/auth-with-password', {
            'identity': os.environ.get('STAGING_ADMIN_EMAIL', 'natali@events-luzern.test'),
            'password': os.environ['TICKET_STAFF_PASSWORD']})
        if status != 200:
            raise RuntimeError('Staging admin login failed')
        cls.admin_cookie = 'pb_auth=' + admin['token']
        cls.prefix = 'fixture-' + secrets.token_hex(5)
        cls.events, cls.orders, cls.tickets = [], [], []
        cls.future = cls.event(72)
        cls.soon = cls.event(23)
        cls.normal = cls.order(cls.future, notify=True)
        cls.reminder = cls.order(cls.soon, old=True)
        cls.late = cls.order(cls.soon, notify=True)
        cls.unpaid = cls.order(cls.future, status='pending')
        cls.large = cls.event(96)
        for i in range(11):
            cls.order(cls.large, quantity=10 if i < 10 else 5)

    @classmethod
    def tearDownClass(cls):
        with sqlite3.connect(cls.db, timeout=15) as db:
            for table, ids in [('tickets', cls.tickets), ('orders', cls.orders), ('checkout_events', cls.events)]:
                db.executemany('DELETE FROM ' + table + ' WHERE id=?', [(id,) for id in ids])

    @classmethod
    def request(cls, path, body=None, method=None, headers=None, raw=False):
        hdr = {'Origin': cls.origin, 'X-Staff-Token': cls.token,
               'Content-Type': 'application/json'}
        if path.startswith('/mail/'):
            hdr['Cookie'] = cls.admin_cookie
        hdr.update(headers or {})
        req = urllib.request.Request(cls.origin + path, data=json.dumps(body).encode() if body is not None else None,
                                     headers=hdr, method=method)
        try:
            response = urllib.request.urlopen(req, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            content = response.read()
            return response.status, content if raw else json.loads(content or '{}')

    @classmethod
    def insert(cls, table, data):
        with sqlite3.connect(cls.db, timeout=15) as db:
            db.execute('INSERT INTO ' + table + ' (' + ','.join('"'+k+'"' for k in data) + ') VALUES (' +
                       ','.join('?' for _ in data) + ')', list(data.values()))

    @classmethod
    def event(cls, hours):
        id = secrets.token_hex(7) + 'e'
        details = {lang: {'entry': 'Тестовый вход, дверь № 2', 'bring': 'Билет; хорошее настроение'} for lang in ('ru', 'de', 'en')}
        event = dict(id=id, slug=cls.prefix+'-'+id, name='[ТЕСТ] '+cls.prefix,
                     starts_at=(datetime.now(timezone.utc)+timedelta(hours=hours)).isoformat(), ends_at='',
                     time_label='Тестовое время', venue='Тестовая площадка', address='Тестовый адрес',
                     currency='chf', unit_amount=15000, enabled=1, reminders=1, details=json.dumps(details))
        cls.insert('checkout_events', event); cls.events.append(id)
        return event

    @classmethod
    def order(cls, event, quantity=2, old=False, notify=False, status='paid'):
        id = secrets.token_hex(7) + 'o'
        buyer = cls.prefix+'-'+id+'@example.com'
        guests = [{'name': 'Гость '+str(i+1), 'email': '' if i==0 else cls.prefix+'-'+id+'-'+str(i)+'@example.com',
                   'wishes': 'Без орехов' if i==0 else ''} for i in range(quantity)]
        created = (datetime.now(timezone.utc)-timedelta(days=2 if old else 0)).isoformat()
        snapshot = {**event, 'details': json.loads(event['details'])}
        cls.insert('orders', dict(id=id, event_id=event['slug'], name='Покупатель', email=buyer, phone='+41000000000',
                   quantity=quantity, language='ru', message='', amount=15000*quantity, currency='chf',
                   checkout_key=secrets.token_hex(20), payload_hash=secrets.token_hex(32), status=status,
                   stripe_session='', checkout_url='', created=created, newsletter_opt_in=0,
                   receipt_sent=int(not notify), owner_notified=int(not notify), reminder_sent=0,
                   guests=json.dumps(guests), event_snapshot=json.dumps(snapshot)))
        cls.orders.append(id)
        tickets=[]
        for i, guest in enumerate(guests):
            ticket = dict(id=secrets.token_hex(7)+'t', order=id, position=i+1, token=secrets.token_hex(20),
                          **guest, checked_in='', checked_by='', email_sent=int(not notify), reminder_sent=0, created=created)
            cls.insert('tickets', ticket); cls.tickets.append(ticket['id']); tickets.append(ticket)
        return dict(id=id, email=buyer, tickets=tickets, event=event)

    def test_private_data_and_staff_auth(self):
        for path in ('events', 'tickets?event='+self.future['slug']):
            self.assertEqual(self.request('/api/events/staff/'+path, headers={'X-Staff-Token':''})[0], 401)
        for collection in ('orders','tickets','checkout_events','ticket_staff'):
            self.assertEqual(self.request('/api/collections/'+collection+'/records')[0], 403)
        ticket=self.normal['tickets'][0]
        status, data=self.request('/api/events/tickets/'+ticket['token'])
        self.assertEqual(status,200)
        self.assertEqual(set(data),{'name','number','event','language','checked_in'})
        self.assertNotIn('Без орехов', json.dumps(data,ensure_ascii=False))
        self.assertEqual(self.request('/api/events/tickets/'+self.unpaid['tickets'][0]['token'])[0],404)
        self.assertEqual(self.request('/api/events/tickets/'+'a'*40)[0],404)

    def test_concurrent_checkin_and_wrong_event(self):
        body={'event_id':self.future['slug'],'token':self.normal['tickets'][0]['token']}
        self.assertEqual(self.request('/api/events/staff/check-in',body,headers={'Origin':'https://example.com'})[0],403)
        self.assertEqual(self.request('/api/events/staff/check-in',{**body,'event_id':self.soon['slug']})[0],400)
        self.assertEqual(self.request('/api/events/staff/check-in',{**body,'token':self.unpaid['tickets'][0]['token']})[0],400)
        with concurrent.futures.ThreadPoolExecutor(5) as pool:
            results=list(pool.map(lambda _:self.request('/api/events/staff/check-in',body),range(5)))
        self.assertTrue(all(code==200 for code,_ in results),results)
        self.assertEqual(sum(not result['already_used'] for _,result in results),1)
        self.assertEqual(len({result['ticket']['checked_in'] for _,result in results}),1)

    def test_undo_arrival_and_rescan(self):
        order=self.order(self.future)
        ticket=order['tickets'][0]
        body={'event_id':self.future['slug'],'ticket_id':ticket['id']}
        list_path='/api/events/staff/tickets?event='+self.future['slug']
        _,before=self.request(list_path)
        status,arrival=self.request('/api/events/staff/check-in',body)
        self.assertEqual((status,arrival['already_used']),(200,False))
        _,arrived=self.request(list_path+'&state=arrived')
        self.assertEqual(arrived['arrived'],before['arrived']+1)
        self.assertIn(ticket['id'],[item['id'] for item in arrived['items']])
        undo={**body,'checked_in':arrival['ticket']['checked_in']}
        with concurrent.futures.ThreadPoolExecutor(3) as pool:
            results=list(pool.map(lambda _:self.request('/api/events/staff/undo-check-in',undo),range(3)))
        self.assertTrue(all(code==200 for code,_ in results),results)
        self.assertEqual(sum(not result['already_undone'] for _,result in results),1)
        self.assertTrue(all(not result['ticket']['checked_in'] for _,result in results))
        _,waiting=self.request(list_path+'&state=waiting')
        self.assertEqual((waiting['arrived'],waiting['paid']),(before['arrived'],before['paid']))
        self.assertIn(ticket['id'],[item['id'] for item in waiting['items']])
        _,public=self.request('/api/events/tickets/'+ticket['token'])
        self.assertEqual(public['checked_in'],'')
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT checked_by FROM tickets WHERE id=?',(ticket['id'],)).fetchone()[0],'')
            self.assertEqual(db.execute('SELECT status,quantity,amount FROM orders WHERE id=?',(order['id'],)).fetchone(),('paid',2,30000))
        status,new_arrival=self.request('/api/events/staff/check-in',{'event_id':self.future['slug'],'token':ticket['token']})
        self.assertEqual((status,new_arrival['already_used']),(200,False))
        self.assertNotEqual(new_arrival['ticket']['checked_in'],undo['checked_in'])
        status,error=self.request('/api/events/staff/undo-check-in',undo)
        self.assertEqual((status,error['message'].rstrip('.')),(400,'Attendance changed'))
        _,duplicate=self.request('/api/events/staff/check-in',body)
        self.assertTrue(duplicate['already_used'])
        self.assertEqual(duplicate['ticket']['checked_in'],new_arrival['ticket']['checked_in'])

    def test_undo_requires_staff_and_matching_paid_ticket(self):
        ticket=self.order(self.future)['tickets'][0]
        body={'event_id':self.future['slug'],'ticket_id':ticket['id']}
        _,arrival=self.request('/api/events/staff/check-in',body)
        body['checked_in']=arrival['ticket']['checked_in']
        path='/api/events/staff/undo-check-in'
        self.assertEqual(self.request(path,body,headers={'X-Staff-Token':''})[0],401)
        self.assertEqual(self.request(path,body,headers={'Origin':'https://example.com'})[0],403)
        self.assertEqual(self.request(path,{**body,'event_id':self.soon['slug']})[0],400)
        self.assertEqual(self.request(path,{**body,'ticket_id':self.unpaid['tickets'][0]['id']})[0],400)
        self.assertEqual(self.request(path,{**body,'checked_in':''})[0],400)
        self.assertEqual(self.request(path,{**body,'ticket_id':'missing-ticket'})[0],404)
        _,unchanged=self.request('/api/events/tickets/'+ticket['token'])
        self.assertEqual(unchanged['checked_in'],body['checked_in'])

    def test_large_list_pagination_and_search(self):
        path='/api/events/staff/tickets?event='+self.large['slug']
        code,first=self.request(path);_,second=self.request(path+'&page=2')
        self.assertEqual((code,first['total'],first['paid'],first['arrived']),(200,105,105,0))
        self.assertEqual((len(first['items']),len(second['items'])),(100,5))
        self.assertEqual(len({x['id'] for x in first['items']+second['items']}),105)
        _,filtered=self.request(path+'&q='+urllib.parse.quote('Гость 10'))
        self.assertEqual((filtered['total'],len(filtered['items'])),(10,10))
        _,empty=self.request(path+'&q='+urllib.parse.quote("' OR 1=1 --"))
        self.assertEqual(empty['total'],0)

    def test_qr_and_calendar(self):
        try:
            import zxingcpp
            from PIL import Image
            from icalendar import Calendar
        except ImportError:
            self.skipTest('Install zxing-cpp, Pillow and icalendar for decoding checks')
        for ticket in self.normal['tickets']:
            path='/api/events/tickets/'+ticket['token']
            code,gif=self.request(path+'/qr.gif',raw=True)
            self.assertEqual(code,200)
            decoded=zxingcpp.read_barcode(Image.open(io.BytesIO(gif)).convert('RGB'))
            self.assertEqual(decoded.text,self.origin+'/ticket/'+ticket['token'])
            code,raw=self.request(path+'/calendar.ics',raw=True)
            self.assertEqual(code,200)
            event=Calendar.from_ical(raw).walk('VEVENT')[0]
            self.assertEqual(str(event['summary']),self.future['name'])
            self.assertEqual(event.decoded('dtstart').replace(microsecond=0),datetime.fromisoformat(self.future['starts_at']).replace(microsecond=0))
            self.assertIn('Тестовый вход, дверь № 2',str(event['description']))
            self.assertTrue(all(len(line)<=75 for line in raw.split(b'\r\n')))

    def test_z_mail_and_reminders(self):
        def messages():
            _,result=self.request('/mail/api/v1/messages?limit=1000')
            return [m for m in result['messages'] if self.prefix in m['Subject']]
        deadline=time.monotonic()+90
        found=[]
        while time.monotonic()<deadline:
            found=messages()
            if len(found)>=8: break
            time.sleep(2)
        self.assertEqual(len(found),8,[(m['To'],m['Subject']) for m in found])
        for order,expected in [(self.normal,3),(self.reminder,2),(self.late,3)]:
            contacts={order['email'],order['tickets'][1]['email']}
            relevant=[m for m in found if m['To'][0]['Address'] in contacts]
            self.assertEqual(len(relevant),2)
            for summary in relevant:
                _,mail=self.request('/mail/api/v1/message/'+summary['ID'])
                buyer=summary['To'][0]['Address']==order['email']
                self.assertEqual(len(mail['Inline']),2 if buyer else 1)
                self.assertEqual([a['FileName'] for a in mail['Attachments']],['event.ics'])
                self.assertIn('Тестовый вход, дверь № 2',mail['Text'])
                self.assertIn('Напоминание' if order is self.reminder else 'Ваши билеты',mail['Subject'])
                self.assertNotIn('Гость 1',mail['Text'] if not buyer else '')
        # One more scheduler tick must not send duplicates.
        time.sleep(65)
        self.assertEqual(len(messages()),8)


if __name__ == '__main__':
    unittest.main()
