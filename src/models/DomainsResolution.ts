import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import {
  IsObject,
  IsOptional,
  Matches,
  NotEquals,
  IsEnum,
} from 'class-validator';
import ValidateWith from '../services/ValidateWith';
import * as _ from 'lodash';
import { Domain, Model } from '.';
import { Attributes, Blockchain } from '../types/common';
import { ETHAddressRegex } from '../utils/ethersUtils';

@Entity({ name: 'domains_resolution' })
@Unique(['domain', 'blockchain', 'networkId'])
@Index(['domain', 'blockchain', 'networkId', 'ownerAddress'])
export default class DomainsResolution extends Model {
  static NullAddress = '0x0000000000000000000000000000000000000000';

  @IsOptional()
  @Matches(ETHAddressRegex)
  @Column('text', { nullable: true })
  @Index()
  ownerAddress: string | null = null;

  @IsOptional()
  @Matches(ETHAddressRegex)
  @NotEquals(DomainsResolution.NullAddress)
  @Column('text', { nullable: true })
  resolver: string | null = null;

  @IsOptional()
  @Column('text', { nullable: true })
  registry: string | null = null;

  @IsOptional()
  @IsObject()
  @ValidateWith<DomainsResolution>('validResolution', {
    message: 'resolution does not match Record<string, string> type',
  })
  @Column('jsonb', { default: {} })
  resolution: Record<string, string> = {};

  @IsEnum(Blockchain)
  @Column('text')
  blockchain: Blockchain;

  @Column('int')
  networkId: number;

  @Column({
    name: 'domain_id',
    comment: 'the resolution domain',
  })
  @Index()
  domainId: number;

  @ManyToOne(() => Domain, (domain) => domain.resolutions)
  @JoinColumn({ name: 'domain_id' })
  domain: Domain;

  constructor(attributes?: Attributes<DomainsResolution>) {
    super();
    this.attributes<DomainsResolution>(attributes);
  }

  validResolution(): boolean {
    for (const property in this.resolution) {
      if (
        !Object.prototype.hasOwnProperty.call(this.resolution, property) ||
        false === _.isString(property) ||
        false === _.isString(this.resolution[property])
      ) {
        return false;
      }
    }

    return true;
  }
}
