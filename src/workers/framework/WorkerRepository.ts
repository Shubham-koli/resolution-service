import {
  DeleteResult,
  EntityManager,
  getConnection,
  Repository,
} from 'typeorm';
import winston from 'winston';
import { WorkerLogger } from '../../logger';
import {
  CnsRegistryEvent,
  Domain as DbDomain,
  DomainsResolution,
  DomainsReverseResolution,
  WorkerStatus,
  ZnsTransaction,
} from '../../models';
import { Blockchain } from '../../types/common';
import { unwrap } from '../../utils/option';
import { convertToArray } from '../../utils/common';
import { cacheSocialPictureInCDN } from '../../utils/socialPicture';
import { IWorkerRepository } from './IWorkerRepository';
import { Domain, Resolution, ReverseResolution, WorkerEvent } from './Types';

// A db connection with its own manager and repositories
class WorkerRepositoryTxContext {
  manager: EntityManager;
  eventRepository: Repository<CnsRegistryEvent>;
  domainRepository: Repository<DbDomain>;
  domainResolutionRepository: Repository<DomainsResolution>;
  domainReverseRepository: Repository<DomainsReverseResolution>;
  workerStatusRepository: Repository<WorkerStatus>;
  znsTransactionRepository: Repository<ZnsTransaction>;
}

export class WorkerRepository implements IWorkerRepository {
  private blockchain: Blockchain;
  private networkId: number;
  private static txContexts: Record<
    Blockchain,
    WorkerRepositoryTxContext | undefined
  > = {
    ETH: undefined,
    ZIL: undefined,
    MATIC: undefined,
  };
  logger: winston.Logger;

  private constructor(blockchain: Blockchain, networkId: number) {
    this.blockchain = blockchain;
    this.networkId = networkId;
    this.logger = WorkerLogger(blockchain);
  }

  private get context(): WorkerRepositoryTxContext {
    const context = WorkerRepository.txContexts[this.blockchain];
    if (!context) {
      throw Error('transaction closed');
    }
    return context;
  }

  public async saveDomains(domain: Domain | Domain[]): Promise<void> {
    // find all nodes in DB
    const domains = convertToArray(domain);
    const domainsToSave: DbDomain[] = [];
    for (const domain of domains) {
      const dbDomain = await DbDomain.findByNode(domain.node);
      const parent = await DbDomain.findByNode(domain.parentNode);
      let name = domain.name;
      if (parent && domain.label && domain.parentNode) {
        name = `${domain.label}.${parent?.name}`;
      }
      if (dbDomain) {
        // if domain exists only update if something changed
        if (
          dbDomain.name !== name ||
          (parent && dbDomain.parent?.id !== parent?.id)
        ) {
          dbDomain.attributes({
            name: name || dbDomain.name,
            parent: parent || dbDomain.parent,
          });
          domainsToSave.push(dbDomain);
        }
      } else {
        domainsToSave.push(
          new DbDomain({
            node: domain.node,
            name: name,
            parent: parent,
          }),
        );
      }
    }
    await this.context.domainRepository.save(domainsToSave);
  }

  public async saveResolutions(
    resolution: Resolution | Resolution[],
  ): Promise<void> {
    const resolutions = convertToArray(resolution);
    const domainsToSave: DbDomain[] = [];
    for (const resolution of resolutions) {
      if (!resolution.updated) {
        continue;
      }
      const domain = await DbDomain.findByNode(
        resolution.node,
        this.context.domainRepository,
      );
      if (domain) {
        // do nothing if domain doesn't exist
        let dbResolution = domain.getResolution(
          resolution.blockchain,
          resolution.networkId,
        );
        dbResolution = dbResolution.attributes({
          resolution:
            resolution.resolution !== undefined
              ? { ...dbResolution.resolution, ...resolution.resolution }
              : {},
          ownerAddress:
            resolution.ownerAddress !== undefined
              ? resolution.ownerAddress
              : dbResolution.ownerAddress,
          resolver:
            resolution.resolver !== undefined
              ? resolution.resolver
              : dbResolution.resolver,
          registry:
            resolution.registry !== undefined
              ? resolution.registry
              : dbResolution.registry,
        });
        domain.setResolution(dbResolution);

        if (resolution.resolution?.['social.picture.value']) {
          try {
            await cacheSocialPictureInCDN({
              socialPicture: resolution.resolution?.['social.picture.value'],
              domain,
              resolution: dbResolution,
            });
          } catch (error) {
            this.logger.error(
              `Failed to cache PFP for ${resolution.node}: ${error}`,
            );
          }
        }
        domainsToSave.push(domain);
      }
    }
    await this.context.domainRepository.save(domainsToSave);
  }

  public async saveReverseResolutions(
    reverseResolution: ReverseResolution | ReverseResolution[],
  ): Promise<void> {
    const resolutions = convertToArray(reverseResolution);
    const resolutionsToSave: DomainsReverseResolution[] = [];
    const resolutionsToRemove: DomainsReverseResolution[] = [];
    for (const resolution of resolutions) {
      const domain = await DbDomain.findByNode(
        resolution.node,
        this.context.domainRepository,
      );

      const dbResolution = await this.context.domainReverseRepository.findOne(
        {
          blockchain: resolution.blockchain,
          networkId: resolution.networkId,
          reverseAddress: resolution.reverseAddress,
        },
        { relations: ['domain'] },
      );

      if (domain) {
        let domainResolution = domain.getReverseResolution(
          resolution.blockchain,
          resolution.networkId,
        );
        if (!domainResolution) {
          domainResolution = new DomainsReverseResolution({
            blockchain: this.blockchain,
            networkId: this.networkId,
            reverseAddress: resolution.reverseAddress,
            domain: domain,
          });
        }
        resolutionsToSave.push(domainResolution); // save the new

        if (dbResolution) {
          resolutionsToRemove.push(dbResolution); // remove the old
        }
      }
    }
    await this.context.domainReverseRepository.save(resolutionsToSave);
    await this.context.domainReverseRepository.remove(resolutionsToRemove);
  }

  public async removeReverseResolutions(
    reverseResolution: ReverseResolution | ReverseResolution[],
  ): Promise<void> {
    const resolutions = convertToArray(reverseResolution);
    const proms: Promise<DeleteResult>[] = [];
    for (const resolution of resolutions) {
      const deleteArgs: {
        blockchain: Blockchain;
        networkId: number;
        reverseAddress?: string;
        domain?: { node: string };
      } = {
        blockchain: resolution.blockchain,
        networkId: resolution.networkId,
      };
      if (resolution.reverseAddress) {
        deleteArgs.reverseAddress = resolution.reverseAddress;
      } else if (resolution.node) {
        deleteArgs.domain = { node: resolution.node };
      } else {
        throw Error('Insufficient params to delete.');
      }
      proms.push(this.context.domainReverseRepository.delete(deleteArgs));
    }
    await Promise.all(proms);
  }

  // specific methods with custom logic for the base worker, not accessible to worker strategies
  public async saveEvents(event: WorkerEvent | WorkerEvent[]): Promise<void> {
    const events = convertToArray(event);
    const znsEvents = Object.values(
      events
        .filter((e) => e.source?.blockchain === Blockchain.ZIL) // filter out zil events
        .map((e) => {
          // map to zil transactions
          return new ZnsTransaction({
            hash: e.source?.attributes?.transactionHash as string,
            blockNumber: e.source?.blockNumber,
            atxuid: e.source?.attributes?.atxuid as number,
            events: e.type
              ? [{ name: unwrap(e.type), params: unwrap(e.args) }]
              : [],
          });
        })
        .reduce((events, event) => {
          // merge events into one tx to follow legacy schema
          if (event.hash) {
            if (!events[event.hash]) {
              events[event.hash] = event;
            } else {
              events[event.hash].events = [
                ...events[event.hash].events,
                ...event.events,
              ];
            }
          }
          return events;
        }, {} as Record<string, ZnsTransaction>),
    );
    const cnsEvents = events
      .filter((e) => e.source?.blockchain !== Blockchain.ZIL)
      .map((e) => {
        return new CnsRegistryEvent(
          {
            contractAddress: e.source?.attributes?.contractAddress as
              | string
              | undefined,
            type: e.type,
            blockchain: e.source?.blockchain,
            networkId: e.source?.networkId,
            blockNumber: e.source?.blockNumber,
            blockHash: e.source?.attributes?.blockHash as string | undefined,
            logIndex: e.source?.attributes?.logIndex as number | undefined,
            transactionHash: e.source?.attributes?.transactionHash as
              | string
              | undefined,
            returnValues: e.args,
            node: e.node,
          },
          this.context.eventRepository,
        ).toObject();
      });
    await Promise.all([
      this.context.eventRepository.save(cnsEvents),
      this.context.znsTransactionRepository.save(znsEvents),
    ]);
  }

  public async findEventsForDomain(tokenId: string): Promise<WorkerEvent[]> {
    if (this.blockchain === Blockchain.ZIL) {
      throw new Error('unsupported');
    }
    return (
      await this.context.eventRepository.find({
        where: {
          node: tokenId,
          blockchain: this.blockchain,
          networkId: this.networkId,
        },
        order: { blockNumber: 'ASC', logIndex: 'ASC' },
      })
    ).map(
      (e) =>
        ({
          node: e.node,
          type: e.type,
          source: {
            blockchain: e.blockchain,
            networkId: e.networkId,
            blockNumber: e.blockNumber,
            attributes: {
              contractAddress: e.contractAddress,
              blockHash: e.blockHash,
              logIndex: e.logIndex,
              transactionHash: e.transactionHash,
            },
          },
          args: e.returnValues,
        } as WorkerEvent),
    );
  }

  public async cleanUpEvents(
    block: number,
  ): Promise<{ deleted: number; affected: Set<string> }> {
    if (this.blockchain === Blockchain.ZIL) {
      throw new Error('unsupported');
    }
    const repository = this.context.eventRepository;
    return CnsRegistryEvent.cleanUpEvents(
      block,
      this.blockchain,
      this.networkId,
      repository,
    );
  }

  public async latestEventBlocks(
    count: number,
  ): Promise<{ blockNumber: number; blockHash: string }[]> {
    if (this.blockchain === Blockchain.ZIL) {
      throw new Error('unsupported');
    }
    const repository = this.context.eventRepository;
    return CnsRegistryEvent.latestEventBlocks(
      count,
      this.blockchain,
      this.networkId,
      repository,
    );
  }

  public async removeAllResolutionsForDomain(node: string): Promise<void> {
    const domain = await DbDomain.findByNode(node);
    const resolution = domain?.getResolution(this.blockchain, this.networkId);
    if (resolution) {
      await this.context.domainResolutionRepository.remove(resolution);
    }
    const reverse = domain?.getReverseResolution(
      this.blockchain,
      this.networkId,
    );
    if (reverse) {
      await this.context.domainReverseRepository.remove(reverse);
    }
  }

  // worker status
  public getLatestMirroredBlock(): Promise<number> {
    return WorkerStatus.latestMirroredBlockForWorker(
      this.blockchain,
      this.context.workerStatusRepository,
    );
  }

  public getLatestMirroredBlockHash(): Promise<string | undefined> {
    return WorkerStatus.latestMirroredBlockHashForWorker(
      this.blockchain,
      this.context.workerStatusRepository,
    );
  }

  public getLatestAtxuidBlockHash(): Promise<number | undefined> {
    return WorkerStatus.latestAtxuidForWorker(
      this.blockchain,
      this.context.workerStatusRepository,
    );
  }

  public saveLastMirroredBlock(
    currentSyncBlock: number,
    currentSyncBlockHash?: string,
  ): Promise<void> {
    return WorkerStatus.saveWorkerStatus(
      this.blockchain,
      currentSyncBlock,
      currentSyncBlockHash,
      undefined,
      this.context.workerStatusRepository,
    );
  }

  // static tx management methods
  public static getRepository(
    blockchain: Blockchain,
    networkId: number,
  ): WorkerRepository {
    if (!WorkerRepository.txContexts[blockchain]) {
      const context: WorkerRepositoryTxContext =
        new WorkerRepositoryTxContext(); // = txContexts
      context.manager = getConnection().createQueryRunner().manager;
      context.eventRepository = context.manager.getRepository(CnsRegistryEvent);
      context.znsTransactionRepository =
        context.manager.getRepository(ZnsTransaction);
      context.domainRepository = context.manager.getRepository(DbDomain);
      context.domainResolutionRepository =
        context.manager.getRepository(DomainsResolution);
      context.domainReverseRepository = context.manager.getRepository(
        DomainsReverseResolution,
      );
      context.workerStatusRepository =
        context.manager.getRepository(WorkerStatus);
      WorkerRepository.txContexts[blockchain] = context;
    }
    return new WorkerRepository(blockchain, networkId);
  }

  public static async startTransaction(
    blockchain: Blockchain,
    networkId: number,
  ): Promise<WorkerRepository> {
    const repo = WorkerRepository.getRepository(blockchain, networkId);
    await repo.context.manager.queryRunner?.startTransaction('REPEATABLE READ');
    await WorkerStatus.lockBlockchainStatus(blockchain, repo.context.manager);
    return repo;
  }

  public static async commitTransaction(blockchain: Blockchain): Promise<void> {
    const context = WorkerRepository.txContexts[blockchain];
    try {
      await context?.manager.queryRunner?.commitTransaction();
    } finally {
      await context?.manager.release();
      WorkerRepository.txContexts[blockchain] = undefined;
    }
  }

  public static async rollbackTransaction(
    blockchain: Blockchain,
  ): Promise<void> {
    const context = WorkerRepository.txContexts[blockchain];
    try {
      await context?.manager.queryRunner?.rollbackTransaction();
    } finally {
      await context?.manager.release();
      WorkerRepository.txContexts[blockchain] = undefined;
    }
  }
}

/**
 * Returns a worker repository for a specific blockchain
 * @param blockchain blockchain type
 * @param networkId network id
 * @returns a singleton repository for associated with the specified blockchain and network id
 */
export function getWorkerRepository(
  blockchain: Blockchain,
  networkId: number,
): IWorkerRepository {
  return WorkerRepository.getRepository(blockchain, networkId);
}
