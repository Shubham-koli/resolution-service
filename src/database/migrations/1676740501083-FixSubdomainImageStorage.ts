import { MigrationInterface, QueryRunner, SelectQueryBuilder } from 'typeorm';
import { Domain } from '../../models';
import * as SocialPictureUtils from '../../utils/socialPicture';
import { logger } from '../../logger';
import { splitDomain } from '../../utils/domain';
import { getDomainResolution } from '../../services/Resolution';

const LOG_PREFIX = 'FixSubdomainImageStorage1676740501083';

const fixImageOverlayInCloudStorage = async (subdomains: Array<Domain>) => {
  for (const subdomain of subdomains) {
    logger.info(`${LOG_PREFIX} - processing subdomain ${subdomain.name}`);
    const { label } = splitDomain(subdomain.name);
    const resolution = getDomainResolution(subdomain);

    try {
      const socialPictureValue = resolution.resolution['social.picture.value'];

      if (!socialPictureValue) {
        logger.info(
          `${LOG_PREFIX} - skip for no social picture ${subdomain.name}`,
        );
        continue;
      }

      const storedImage = await SocialPictureUtils.getNftPfpImageFromCDN(
        socialPictureValue,
        subdomain.name,
      );

      if (!storedImage) {
        // skip if image is not found
        logger.info(
          `${LOG_PREFIX} - skip for no image stored ${subdomain.name}`,
        );
        continue;
      }

      if (storedImage.includes(label)) {
        // skip if image is already correct
        logger.info(
          `${LOG_PREFIX} - skip for already correct picture ${subdomain.name}`,
        );
        continue;
      }

      await SocialPictureUtils.cacheSocialPictureInCDN({
        socialPicture: socialPictureValue,
        domain: subdomain,
        resolution,
        shouldOverrideOverlayImage: true,
      });

      logger.info(`${LOG_PREFIX} - fixed image of subdomain ${subdomain.name}`);
    } catch (error) {
      logger.error(
        `${LOG_PREFIX} - failed to process ${subdomain.name} ${error}`,
      );
    }
  }
};

const withLimitIlterator = (
  queryBuilder: SelectQueryBuilder<Domain>,
  options: {
    limit?: number;
  },
) => {
  const limit = options.limit || 10;

  let offset = 0;
  let done = false;

  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<{
          value: Array<Domain>;
          done: boolean;
        }> {
          const results = await queryBuilder
            .limit(limit)
            .offset(offset)
            .getMany();
          offset += limit;

          if (!results.length) {
            done = true;
          }

          return Promise.resolve({
            value: results.slice(0, 10),
            done,
          });
        },
      };
    },
  };
};

export class FixSubdomainImageStorage1676740501083
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    try {
      const queryBuilder = Domain.createQueryBuilder('domain')
        .where(
          `array_length(regexp_split_to_array(domain.name, E'\\\\.'), 1) > 2`,
        )
        .leftJoinAndSelect('domain.resolutions', 'resolution');

      const queryIterator = withLimitIlterator(queryBuilder, {
        limit: 10,
      });

      for await (const subdomains of queryIterator) {
        await fixImageOverlayInCloudStorage(subdomains);
      }
    } catch (e) {
      logger.error(`${LOG_PREFIX} - Failed to execute complete`, e);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // not applicable
  }
}
