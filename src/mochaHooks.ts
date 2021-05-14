import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import chaiSubset from 'chai-subset';
import 'chai/register-expect';
import connect from './database/connect';
import { getConnection } from 'typeorm';
import fixtures from './fixtures';

chai.use(chaiSubset);
chai.use(chaiAsPromised);

if (process.env.NODE_ENV !== 'test') {
  throw new Error('NODE_ENV set to ' + process.env.NODE_ENV);
}
export const mochaHooks = {
  async beforeAll(): Promise<void> {
    await connect();
    // Why does following line think there are pending migrations?
    // if (await getConnection().showMigrations()) {
    //   throw new Error('Have a pending migrations');
    // }
  },
  async beforeEach(): Promise<void> {
    const tableNames = getConnection().entityMetadatas.map((v) => v.tableName);
    await getConnection().query(
      tableNames
        .map((tableName) => `ALTER TABLE ${tableName} DISABLE TRIGGER ALL;`)
        .join('') +
        tableNames.map((tableName) => `DELETE FROM ${tableName};`).join('') +
        tableNames
          .map((tableName) => `ALTER TABLE ${tableName} ENABLE TRIGGER ALL;`)
          .join(''),
    );
    await fixtures();
  },
};