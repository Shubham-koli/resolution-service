import supertest from 'supertest';
import { api } from '../api';
import { expect } from 'chai';
import { ApiKey, CnsRegistryEvent } from '../models';
import { DomainTestHelper } from '../utils/testing/DomainTestHelper';
import * as heap from '../utils/heap';
import { HeapEvents } from '../types/heap';
import { describe } from 'mocha';
import sinon from 'sinon';

import { commonParamsValidatorTestSuite } from './CommonTestSuites.test';

describe('DomainsController', () => {
  let testApiKey: ApiKey;
  let trackStub: sinon.SinonStub;
  const SUPERTEST_TESTING_IP = '::ffff:127.0.0.1';

  beforeEach(async () => {
    testApiKey = await ApiKey.createApiKey('testing key');
    trackStub = sinon.stub(heap, 'track');
  });

  afterEach(async () => {
    trackStub.restore();
  });

  describe('GET /domains/:domainName/transfers/latest', async () => {
    type eventsTestData = { from: string; to: string }[];
    async function saveCnsEvents(
      tokenId: string,
      l1events: eventsTestData,
      l2events: eventsTestData,
    ) {
      for (let i = 0; i < l1events.length; i++) {
        const event = l1events[i];
        await new CnsRegistryEvent({
          contractAddress: '0xdead1dead1dead1dead1dead1dead1dead1dead1',
          type: 'Transfer',
          blockchain: 'ETH',
          networkId: 1,
          blockNumber: i,
          blockHash: `0x${i}`,
          logIndex: 1,
          returnValues: { tokenId: tokenId, from: event.from, to: event.to },
        }).save();
      }
      for (let i = 0; i < l2events.length; i++) {
        const event = l2events[i];
        await new CnsRegistryEvent({
          contractAddress: '0xdead2dead2dead2dead2dead2dead2dead2dead2',
          type: 'Transfer',
          blockchain: 'MATIC',
          networkId: 137,
          blockNumber: i + 1000,
          blockHash: `0x${i + 1000}`,
          logIndex: 1,
          returnValues: { tokenId: tokenId, from: event.from, to: event.to },
        }).save();
      }
    }

    commonParamsValidatorTestSuite({
      getPath: (domain: string) => `/domains/${domain}/transfers/latest`,
      isAuthRequired: true,
      includeDomainNameTests: true,
      includeTokenTests: false,
    });

    it('should return latest transfers from MATIC and ETH networks', async () => {
      const { domain: testDomain } = await DomainTestHelper.createTestDomainL2(
        {
          name: 'kirill.dao',
          node: '0x06fd626e68ed0311d37c040c788137dc168124856fdb3b5ec37f54e98dd764ef',
        },
        {
          ownerAddress: '0xea674fdde714fd979de3edf0f56aa9716b898ec8',
          registry: '0xd1e5b0ff1287aa9f9a268759062e4ab08b9dacbe',
        },
        {
          ownerAddress: '0x58ca45e932a88b2e7d0130712b3aa9fb7c5781e2',
          registry: '0xd1e5b0ff1287aa9f9a268759062e4ab08b9dacbe',
        },
      );
      await saveCnsEvents(
        testDomain.node,
        [
          {
            from: '0x0000000000000000000000000000000000000000',
            to: '0x58ca45e932a88b2e7d0130712b3aa9fb7c5781e2',
          },
          {
            from: '0x58ca45e932a88b2e7d0130712b3aa9fb7c5781e2',
            to: '0xea674fdde714fd979de3edf0f56aa9716b898ec8',
          },
        ],
        [
          {
            from: '0x0000000000000000000000000000000000000000',
            to: '0x58ca45e932a88b2e7d0130712b3aa9fb7c5781e2',
          },
          {
            from: '0x58ca45e932a88b2e7d0130712b3aa9fb7c5781e2',
            to: '0xea674fdde714fd979de3edf0f56aa9716b898ec8',
          },
          {
            from: '0xea674fdde714fd979de3edf0f56aa9716b898ec8',
            to: '0x58ca45e932a88b2e7d0130712b3aa9fb7c5781e2',
          },
        ],
      );

      const res = await supertest(api)
        .get(`/domains/${testDomain.name}/transfers/latest`)
        .auth(testApiKey.apiKey, { type: 'bearer' })
        .send();

      expect(res.status).eq(200);
      expect(res.body).to.deep.eq({
        data: [
          {
            domain: testDomain.name,
            from: '0x58ca45e932a88b2e7d0130712b3aa9fb7c5781e2',
            to: '0xea674fdde714fd979de3edf0f56aa9716b898ec8',
            blockNumber: 1,
            networkId: 1,
            blockchain: 'ETH',
          },
          {
            domain: testDomain.name,
            from: '0xea674fdde714fd979de3edf0f56aa9716b898ec8',
            to: '0x58ca45e932a88b2e7d0130712b3aa9fb7c5781e2',
            blockNumber: 1002,
            networkId: 137,
            blockchain: 'MATIC',
          },
        ],
      });
      expect(trackStub).to.be.calledWith({
        identity: SUPERTEST_TESTING_IP,
        eventName: HeapEvents.GET_LATEST_DOMAIN_TRANSFER,
        properties: {
          apiKey: testApiKey.apiKey,
          domainName: testDomain.name,
          uri: `/domains/${testDomain.name}/transfers/latest`,
          responseCode: 200,
        },
      });
    });

    it('should not heap track extra queries on response', async () => {
      const { domain: testDomain } = await DomainTestHelper.createTestDomainL2(
        {
          name: 'kirill.dao',
          node: '0x06fd626e68ed0311d37c040c788137dc168124856fdb3b5ec37f54e98dd764ef',
        },
        {
          ownerAddress: '0xea674fdde714fd979de3edf0f56aa9716b898ec8',
          registry: '0xd1e5b0ff1287aa9f9a268759062e4ab08b9dacbe',
        },
        {
          ownerAddress: '0x58ca45e932a88b2e7d0130712b3aa9fb7c5781e2',
          registry: '0xd1e5b0ff1287aa9f9a268759062e4ab08b9dacbe',
        },
      );
      await saveCnsEvents(
        testDomain.node,
        [
          {
            from: '0x0000000000000000000000000000000000000000',
            to: '0x58ca45e932a88b2e7d0130712b3aa9fb7c5781e2',
          },
          {
            from: '0x58ca45e932a88b2e7d0130712b3aa9fb7c5781e2',
            to: '0xea674fdde714fd979de3edf0f56aa9716b898ec8',
          },
        ],
        [
          {
            from: '0x0000000000000000000000000000000000000000',
            to: '0x58ca45e932a88b2e7d0130712b3aa9fb7c5781e2',
          },
          {
            from: '0x58ca45e932a88b2e7d0130712b3aa9fb7c5781e2',
            to: '0xea674fdde714fd979de3edf0f56aa9716b898ec8',
          },
          {
            from: '0xea674fdde714fd979de3edf0f56aa9716b898ec8',
            to: '0x58ca45e932a88b2e7d0130712b3aa9fb7c5781e2',
          },
        ],
      );

      const uri = `/domains/${testDomain.name}/transfers/latest?extraParams=123`;
      const res = await supertest(api)
        .get(uri)
        .auth(testApiKey.apiKey, { type: 'bearer' })
        .send();

      expect(res.status).eq(200);
      expect(res.body).to.deep.eq({
        data: [
          {
            domain: testDomain.name,
            from: '0x58ca45e932a88b2e7d0130712b3aa9fb7c5781e2',
            to: '0xea674fdde714fd979de3edf0f56aa9716b898ec8',
            blockNumber: 1,
            networkId: 1,
            blockchain: 'ETH',
          },
          {
            domain: testDomain.name,
            from: '0xea674fdde714fd979de3edf0f56aa9716b898ec8',
            to: '0x58ca45e932a88b2e7d0130712b3aa9fb7c5781e2',
            blockNumber: 1002,
            networkId: 137,
            blockchain: 'MATIC',
          },
        ],
      });
      expect(trackStub).to.be.calledWith({
        identity: SUPERTEST_TESTING_IP,
        eventName: HeapEvents.GET_LATEST_DOMAIN_TRANSFER,
        properties: {
          apiKey: testApiKey.apiKey,
          domainName: testDomain.name,
          uri,
          responseCode: 200,
        },
      });
    });

    it('should return one result if domain has no transfers in another network', async () => {
      const { domain: testDomain } = await DomainTestHelper.createTestDomainL2(
        {
          name: 'kirill.dao',
          node: '0x06fd626e68ed0311d37c040c788137dc168124856fdb3b5ec37f54e98dd764ef',
        },
        {
          ownerAddress: '0xea674fdde714fd979de3edf0f56aa9716b898ec8',
          registry: '0xd1e5b0ff1287aa9f9a268759062e4ab08b9dacbe',
        },
        {
          ownerAddress: '0x58ca45e932a88b2e7d0130712b3aa9fb7c5781e2',
          registry: '0xd1e5b0ff1287aa9f9a268759062e4ab08b9dacbe',
        },
      );
      await saveCnsEvents(
        testDomain.node,
        [],
        [
          {
            from: '0x0000000000000000000000000000000000000000',
            to: '0x58ca45e932a88b2e7d0130712b3aa9fb7c5781e2',
          },
          {
            from: '0x58ca45e932a88b2e7d0130712b3aa9fb7c5781e2',
            to: '0xea674fdde714fd979de3edf0f56aa9716b898ec8',
          },
          {
            from: '0xea674fdde714fd979de3edf0f56aa9716b898ec8',
            to: '0x58ca45e932a88b2e7d0130712b3aa9fb7c5781e2',
          },
        ],
      );

      const res = await supertest(api)
        .get(`/domains/${testDomain.name}/transfers/latest`)
        .auth(testApiKey.apiKey, { type: 'bearer' })
        .send();

      expect(res.status).eq(200);
      expect(res.body).to.deep.eq({
        data: [
          {
            domain: testDomain.name,
            from: '0xea674fdde714fd979de3edf0f56aa9716b898ec8',
            to: '0x58ca45e932a88b2e7d0130712b3aa9fb7c5781e2',
            blockNumber: 1002,
            networkId: 137,
            blockchain: 'MATIC',
          },
        ],
      });
      expect(trackStub).to.be.calledWith({
        identity: SUPERTEST_TESTING_IP,
        eventName: HeapEvents.GET_LATEST_DOMAIN_TRANSFER,
        properties: {
          apiKey: testApiKey.apiKey,
          domainName: testDomain.name,
          uri: `/domains/${testDomain.name}/transfers/latest`,
          responseCode: 200,
        },
      });
    });
  });
});
