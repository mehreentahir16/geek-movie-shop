import os
import logging
from locust import HttpUser, TaskSet, task, between
from random import choice, randint

# Configure logging
logging.basicConfig(
    filename='locust_test.log',
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
)

logger = logging.getLogger(__name__)

class UserBehavior(TaskSet):
    def on_start(self):
        """ on_start is called when a Locust start before any task is scheduled """
        logger.info('Starting')
        self.client.headers.update({'Content-Type': 'application/json'})

    @task
    def login(self):
        credentials = {
            'name': 'user',
            'password': 'password'
        }
        res = self.client.post('/api/user/login', json=credentials)
        if res.status_code != 200:
            logger.error(f'Failed to login, status code: {res.status_code}, response: {res.text}')
        else:
            logger.info(f'login {res.status_code}')

    @task
    def load(self):
        try:
            res_home = self.client.get('/')
            if res_home.status_code != 200:
                logger.error(f'Failed to access home page, status code: {res_home.status_code}, response: {res_home.text}')
                return
            
            logger.info(f'Home page access successful, status code: {res_home.status_code}')

            res_user = self.client.get('/api/user/uniqueid')
            if res_user.status_code == 200:
                user = res_user.json()
                uniqueid = user.get('uuid', 'not found')
                logger.info(f'User {uniqueid}')
            else:
                logger.error(f'Failed to fetch unique ID, status code: {res_user.status_code}, response: {res_user.text}')
                return

            self.client.get('/api/catalogue/categories')
            products = self.client.get('/api/catalogue/products').json()
            for _ in range(2):
                item = None
                while True:
                    item = choice(products)
                    if item['instock'] != 0:
                        break

                if randint(1, 10) <= 3:
                    self.client.put('/api/ratings/api/rate/{}/{}'.format(item['sku'], randint(1, 5)))

                self.client.get('/api/catalogue/product/{}'.format(item['sku']))
                self.client.get('/api/ratings/api/fetch/{}'.format(item['sku']))
                self.client.get('/api/cart/add/{}/{}/1'.format(uniqueid, item['sku']))

            cart = self.client.get('/api/cart/cart/{}'.format(uniqueid)).json()
            item = choice(cart['items'])
            self.client.get('/api/cart/update/{}/{}/2'.format(uniqueid, item['sku']))

            code = choice(self.client.get('/api/shipping/codes').json())
            city = choice(self.client.get('/api/shipping/cities/{}'.format(code['code'])).json())
            logger.info(f'code {code} city {city}')
            shipping = self.client.get('/api/shipping/calc/{}'.format(city['uuid'])).json()
            shipping['location'] = '{} {}'.format(code['name'], city['name'])
            logger.info(f'Shipping {shipping}')
            
            cart = self.client.post('/api/shipping/confirm/{}'.format(uniqueid), json=shipping).json()
            logger.info(f'Final cart {cart}')

            order = self.client.post('/api/payment/pay/{}'.format(uniqueid), json=cart).json()
            logger.info(f'Order {order}')
        
        except Exception as e:
            logger.error(f'Exception during load task: {e}')

    @task
    def error(self):
        if os.environ.get('ERROR', '0') == '1':
            logger.error('Error request')
            cart = {'total': 0, 'tax': 0}
            self.client.post('/api/payment/pay/partner-57', json=cart)

class WebsiteUser(HttpUser):
    tasks = [UserBehavior]
    wait_time = between(1, 5)
