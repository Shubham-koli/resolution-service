import { Network, OpenSeaPort } from 'opensea-js';
import {
  NetworkId,
  OpenSeaMetadata,
  SupportedL2Chain,
  TokenMetadata,
} from '../controllers/dto/Metadata';
import { env } from '../env';
import { Domain, DomainsResolution } from '../models';
import {
  cacheSocialPictureInCDN,
  getNftPfpImageFromCDN,
  parsePictureRecord,
  SocialPictureOptions,
  getOffChainProfileImage,
  getOnChainProfileImage,
} from '../utils/socialPicture';
import { EthereumProvider } from '../workers/eth/EthereumProvider';
import Moralis from 'moralis/node';
import { logger } from '../logger';
import fetch from 'node-fetch';
import { MetadataImageFontSize, UnstoppableDomainTlds } from '../types/common';
import AnimalDomainHelper, {
  OpenSeaMetadataAttribute,
} from '../utils/AnimalDomainHelper/AnimalDomainHelper';
import { belongsToTld, isDeprecatedTLD, isSupportedTLD } from '../utils/domain';
import {
  DomainAttributeTrait,
  getAttributeType,
  getAttributeCategory,
  getAttributeCharacterSet,
  AttributeCharacterSet,
  AttributePictureType,
  CustomImageDomains,
} from '../utils/metadata';
import { DefaultImageData } from '../utils/generalImage';

const BASE_IMAGE_URL = `${env.APPLICATION.ERC721_METADATA.GOOGLE_CLOUD_STORAGE_BASE_URL}/images`;

export class MetadataService {
  private openSeaPort: OpenSeaPort;
  private moralisApi: Moralis;
  private animalHelper: AnimalDomainHelper;

  constructor(
    private _openSeaPort: OpenSeaPort | any,
    private _animalHelper: AnimalDomainHelper | any,
  ) {
    this.openSeaPort =
      _openSeaPort ??
      new OpenSeaPort(EthereumProvider, {
        networkName: Network.Main,
        apiKey: env.OPENSEA.API_KEY,
      });

    this.animalHelper = _animalHelper ?? new AnimalDomainHelper();
  }

  async moralis(): Promise<Moralis> {
    const serverUrl = env.MORALIS.API_URL;
    const appId = env.MORALIS.APP_ID;

    if (!this.moralisApi) {
      await Moralis.start({ serverUrl, appId });
      this.moralisApi = Moralis;
    }

    return this.moralisApi;
  }

  async fetchTokenMetadata(
    resolution: DomainsResolution,
  ): Promise<TokenMetadata> {
    let chainId = '';
    let contractAddress = '';
    let tokenId = '';

    if (resolution.resolution['social.picture.value']) {
      try {
        const parsedPicture: SocialPictureOptions = parsePictureRecord(
          resolution.resolution['social.picture.value'],
        );

        chainId = parsedPicture.chainId;
        contractAddress = parsedPicture.contractAddress;
        tokenId = parsedPicture.tokenId;
      } catch (error) {
        logger.error(`Unable to parse the picture: ${error}`);
      }
    }

    const options = {
      chain: this.getChainName(chainId),
      address: contractAddress,
      token_id: tokenId,
    };
    let image = '';
    let fetchedMetadata;
    let tokenIdMetadata;
    let validNftPfp = false;

    if (options.address && options.token_id) {
      try {
        if (options.chain === 'eth') {
          fetchedMetadata = await this.fetchOpenSeaMetadata(
            contractAddress,
            tokenId,
          );
          image = fetchedMetadata.image;
        } else {
          tokenIdMetadata = await this.fetchMoralisMetadata(options);
        }
      } catch (error: any) {
        logger.error(`Unable to fetch image metadata: ${error}`);
        if (!error.message.includes('No metadata found')) {
          logger.error(error);
        }
      }
    }

    const fetchedOwnerAddress =
      (tokenIdMetadata as any)?.owner_of || fetchedMetadata?.owner_of || '';

    if (
      resolution?.ownerAddress &&
      fetchedOwnerAddress.toLowerCase() ===
        resolution.ownerAddress.toLowerCase()
    ) {
      validNftPfp = true;
    }

    if (validNftPfp && tokenIdMetadata?.metadata) {
      try {
        // TODO: Why are we only parsing if validNftPfp is true? Why not parse regardless
        // so long as tokenIdMetadata.metadata exists?
        fetchedMetadata = JSON.parse(tokenIdMetadata.metadata);
        image = fetchedMetadata?.image;
      } catch (error) {
        console.log(error);
      }
    }

    if (validNftPfp && !image && !!tokenIdMetadata?.token_uri) {
      const response = await fetch(tokenIdMetadata.token_uri, {
        timeout: 5000,
      });
      fetchedMetadata = await response.json();
      image = fetchedMetadata?.image;
    }
    return { fetchedMetadata, image }; // TODO: get rid of socialPicture param
  }

  async defaultMetaResponse(domainOrToken: string): Promise<OpenSeaMetadata> {
    const name = domainOrToken.includes('.') ? domainOrToken : null;

    if (
      name &&
      !isSupportedTLD(name) &&
      // We still want to return metadata for deprecated domains
      !isDeprecatedTLD(name)
    ) {
      return {
        name: null,
        tokenId: null,
        namehash: null,
        description: null,
        external_url: null,
        attributes: [],
        image: null,
      };
    }

    const description = name
      ? this.getDomainDescription(new Domain({ name }), {})
      : null;
    const attributes = name
      ? await this.getAttributeType(new Domain({ name }))
      : [];
    const image = name ? this.generateDomainImageUrl(name) : null;
    const external_url = name
      ? `https://unstoppabledomains.com/search?searchTerm=${name}`
      : null;
    return {
      name,
      tokenId: null,
      namehash: null,
      description,
      external_url,
      attributes,
      image,
    };
  }

  async generateImageData(
    name: string,
    resolution: Record<string, string>,
    withOverlay: boolean,
  ): Promise<string> {
    const domain = new Domain({ name });
    const defaultImage = this.generateDefaultImageData(domain);

    // TLD is deprecated, UD does not support record updates anymore
    if (isDeprecatedTLD(name)) {
      return this.generateDefaultImageData(domain);
    }

    if (this.isDomainWithCustomImage(name)) {
      return '';
    }

    const animalImage = await this.animalHelper.getAnimalImageData(name);
    if (animalImage) {
      return animalImage;
    }

    const onChainProfileImage = await getOnChainProfileImage(
      resolution['social.image.value'],
    );
    if (onChainProfileImage) {
      return onChainProfileImage;
    }

    const offChainProfileImage = await getOffChainProfileImage(
      domain,
      withOverlay,
    );
    if (offChainProfileImage) {
      return offChainProfileImage;
    }

    return defaultImage;
  }

  async getOrCacheNowPfpNFT(
    socialPicture: string,
    domain: Domain,
    resolution: DomainsResolution,
    withOverlay: boolean,
  ): Promise<string | null> {
    const cachedPfpNFT = await getNftPfpImageFromCDN(
      socialPicture,
      withOverlay ? domain.name : undefined,
    );
    if (!cachedPfpNFT) {
      await cacheSocialPictureInCDN({
        socialPicture,
        domain,
        resolution,
      });
      // This is not optimal, should return image instead of 2nd call
      // TODO: improve PFP NFT fetching after caching in CDN
      const trulyCachedPFPNFT = await getNftPfpImageFromCDN(
        socialPicture,
        withOverlay ? domain.name : undefined,
      );
      return trulyCachedPFPNFT;
    }
    return cachedPfpNFT;
  }

  createDefaultImageUrl(name: string): string {
    return `https://metadata.unstoppabledomains.com/image-src/${name}.svg`;
  }

  isDomainWithCustomImage(name: string): boolean {
    return Boolean(CustomImageDomains[name]);
  }

  async getAttributeType(
    domain: Domain,
    meta?: {
      verifiedNftPicture?: boolean;
    },
  ): Promise<OpenSeaMetadataAttribute[]> {
    const attributes: OpenSeaMetadataAttribute[] = [
      {
        trait_type: DomainAttributeTrait.Ending,
        value: domain.extension,
      },
      {
        trait_type: DomainAttributeTrait.Level,
        value: domain.level,
      },
      {
        trait_type: DomainAttributeTrait.Length,
        value: domain.label.length,
      },
      {
        trait_type: DomainAttributeTrait.Subdomains,
        value: await Domain.getSubdomainCountByParentName(domain.name),
      },
      {
        trait_type: DomainAttributeTrait.Type,
        value: getAttributeType(domain),
      },
    ];
    const category = getAttributeCategory(domain);
    if (category) {
      attributes.push({
        trait_type: DomainAttributeTrait.Category,
        value: category,
      });
    }
    const characterSet = getAttributeCharacterSet(domain);
    if (characterSet !== AttributeCharacterSet.None) {
      attributes.push({
        trait_type: DomainAttributeTrait.AttributeCharacterSet,
        value: characterSet,
      });
    }
    if (meta?.verifiedNftPicture) {
      attributes.push({
        trait_type: DomainAttributeTrait.Picture,
        value: AttributePictureType.VerifiedNft,
      });
    }

    return attributes;
  }

  getDomainDescription(
    domain: Domain,
    resolution: Record<string, string>,
  ): string {
    const ipfsDescriptionPart = this.getIpfsDescriptionPart(resolution);

    // todo find a better way for this edge case.
    if (domain.name === 'india.crypto') {
      return 'This exclusive art piece by Amrit Pal Singh features hands of different skin tones spelling out the word HOPE in sign language. Hope embodies people coming together and having compassion for others in a way that transcends geographical borders. This art is a reminder that, while one individual can’t uplift humanity on their own, collective and inclusive efforts give rise to meaningful change.'.concat(
        ipfsDescriptionPart,
      );
    }

    if (domain.level === 1) {
      return "This is the only TLD on the Unstoppable registry. It's not owned by anyone.".concat(
        ipfsDescriptionPart,
      );
    } else if (domain.level === 2 || domain.level === 3) {
      const description = belongsToTld(domain.name, UnstoppableDomainTlds.Coin)
        ? '.coin domains are no longer supported by Unstoppable Domains. As a result, records of such domains cannot be updated. Learn more at our blog: https://unstoppabledomains.com/blog/coin. '
        : 'A CNS or UNS blockchain domain. Use it to resolve your cryptocurrency addresses and decentralized websites.';
      return description.concat(ipfsDescriptionPart);
    }

    return 'BE CAREFUL! This is a subdomain. Even after purchasing this name, the parent domain has the right to revoke ownership of this domain at anytime. Unless the parent is a smart contract specifically designed otherwise.'.concat(
      ipfsDescriptionPart,
    );
  }

  generateDomainImageUrl(name: string): string {
    if (this.isDomainWithCustomImage(name)) {
      return `${BASE_IMAGE_URL}/${CustomImageDomains[name]}`;
    }

    const animalImageUrl = this.animalHelper.getAnimalImageUrl(name);
    if (animalImageUrl) {
      return animalImageUrl;
    }

    return this.createDefaultImageUrl(name);
  }

  private generateDefaultImageData(domain: Domain) {
    let fontSize: MetadataImageFontSize = 24;
    if (domain.label.length > 21) {
      fontSize = 20;
    }
    if (domain.label.length > 24) {
      fontSize = 18;
    }
    if (domain.label.length > 27) {
      fontSize = 16;
    }
    return DefaultImageData({
      domain,
      fontSize,
    });
  }

  private getIpfsDescriptionPart(records: Record<string, string>): string {
    const ipfsHash = records['dweb.ipfs.hash'] || records['ipfs.html.value'];
    if (ipfsHash) {
      return `\nhttps://gateway.pinata.cloud/ipfs/${ipfsHash}`;
    }
    return '';
  }

  private async fetchOpenSeaMetadata(contractAddress: string, tokenId: string) {
    const response = await this.openSeaPort.api.getAsset({
      tokenAddress: contractAddress,
      tokenId: tokenId,
    });
    return {
      image: response.imageUrl.endsWith('=s250')
        ? response.imageUrl.split('=s250')[0]
        : response.imageUrl,
      background_color: response.backgroundColor,
      owner_of: response.owner?.address,
    };
  }

  private async fetchMoralisMetadata(options: {
    chain: SupportedL2Chain | 'eth';
    address: string;
    token_id: string;
  }) {
    const moralis = await this.moralis();
    return await moralis.Web3API.token.getTokenIdMetadata(options);
  }

  getChainName(chainId: string): SupportedL2Chain | 'eth' {
    switch (chainId) {
      case NetworkId.Polygon:
        return SupportedL2Chain.Polygon;
      case NetworkId.Binance:
        return SupportedL2Chain.Binance;
      case NetworkId.Avalanche:
        return SupportedL2Chain.Avalanche;
      case NetworkId.Fantom:
        return SupportedL2Chain.Fantom;
      default:
        return 'eth';
    }
  }
}
