import nodeFetch from 'node-fetch';
import { Domain, DomainsResolution } from '../../models';
import { createCanvas } from 'canvas';
import createSVGfromTemplate, {
  simpleSVGTemplate,
  offChainSVGTemplate,
} from './svgTemplate';
import btoa from 'btoa';
import { env } from '../../env';
import { Storage } from '@google-cloud/storage';
import { logger } from '../../logger';
import { MetadataService } from '../../services/MetadataService';
import { PROFILE_FETCH_TIMEOUT_MS } from '../common';
import * as DomainUtils from '../../utils/domain';

export type SocialPictureOptions = {
  chainId: string;
  nftStandard: string;
  contractAddress: string;
  tokenId: string;
};

const DEFAULT_OVERLAY_FONTSIZE = 54;
const storageOptions = env.CLOUD_STORAGE.API_ENDPOINT_URL
  ? { apiEndpoint: env.CLOUD_STORAGE.API_ENDPOINT_URL } // for development using local emulator
  : {}; // for production
const storage = new Storage(storageOptions);

export const parsePictureRecord = (
  avatarRecord: string,
): SocialPictureOptions => {
  const regex =
    /(\d+)\/(erc721|erc1155|cryptopunks):(0x[a-fA-F0-9]{40})\/(\d+)/;
  const matches = regex.exec(avatarRecord);
  if (!matches || matches.length !== 5) {
    throw new Error('Invalid avatar record');
  }
  const [, chainId, nftStandard, contractAddress, tokenId] = matches;

  return { chainId, nftStandard, contractAddress, tokenId };
};

const makeImageLink = (imageUrl: string) => {
  const PINATA_URL = 'https://gateway.pinata.cloud/ipfs/';
  const IPFS_REGEX = /^ipfs:\/\/(ipfs\/)?(.*$)/i;
  const [_url, _prefix, cid] = imageUrl.match(IPFS_REGEX) ?? [];

  if (cid) {
    return `https://ipfs.io/ipfs/${cid}`;
  }

  if (imageUrl.startsWith(PINATA_URL)) {
    return `https://ipfs.io/ipfs/${imageUrl.split(PINATA_URL)[1]}`;
  }

  if (
    imageUrl.includes('api.pudgypenguins.io/penguin/image') &&
    !imageUrl.endsWith('.svg')
  ) {
    return `${imageUrl}.svg`; // Fixes Pudgy Penguins bug, images missing .svg at the end
  }

  return imageUrl;
};

export const getNFTSocialPicture = async (
  pictureOrUrl: string,
): Promise<[string, string | null]> => {
  if (pictureOrUrl.startsWith('data:')) {
    const mimeType = pictureOrUrl.substring(
      pictureOrUrl.indexOf(':') + 1,
      pictureOrUrl.indexOf(';'),
    );
    const base64 = pictureOrUrl.substring(pictureOrUrl.indexOf('base64,') + 7);
    return [base64, mimeType];
  }

  const resp = await nodeFetch(makeImageLink(pictureOrUrl), { timeout: 5000 });
  if (!resp.ok) {
    throw new Error('Failed to fetch NFT image');
  }
  const data = await resp.buffer();
  const mimeType = resp.headers.get('Content-Type');
  const base64 = data.toString('base64');

  return [base64, mimeType];
};

const getFontSize = (name: string): number => {
  const [label] = name.split('.');
  const canvas = createCanvas(512, 512);
  const ctx = canvas.getContext('2d');
  ctx.font = '18px Arial';
  const text = ctx.measureText(label);
  const fontSize = Math.floor(20 * ((360 - label.length) / text.width));

  if (fontSize > 58) {
    return DEFAULT_OVERLAY_FONTSIZE;
  }

  if (fontSize < 21) {
    return 21;
  }

  return fontSize;
};

export const createSocialPictureImage = (
  domain: Domain,
  data: string,
  mimeType: string | null,
  backgroundColor: string,
  raw = false,
): string => {
  const fontSize = getFontSize(
    DomainUtils.splitDomain(domain.name).label.length > 45
      ? domain.name.substring(0, 45)
      : domain.name,
  );

  const svg = createSVGfromTemplate({
    background_color: backgroundColor,
    background_image: data,
    domain: domain.name,
    fontSize,
    mimeType: mimeType || undefined,
  });

  if (raw) {
    return svg;
  }

  try {
    return toBase64DataURI(svg);
  } catch (e) {
    console.log(e);
    return '';
  }
};

export const getNFTFilenameInCDN = (
  socialPic: string,
  domainToOverlay?: string,
): string => {
  const { chainId, nftStandard, contractAddress, tokenId } =
    parsePictureRecord(socialPic);
  const nftPfpFolder = 'nft-pfp';
  const isDomainNotEmpty = Boolean(domainToOverlay?.trim());
  const overlayPostfix = isDomainNotEmpty ? `_o_${domainToOverlay}` : '';
  return `${nftPfpFolder}/${chainId}_${nftStandard}:${contractAddress}_${tokenId}${overlayPostfix}.svg`;
};

export const cacheSocialPictureInCDN = async (options: {
  socialPicture: string;
  domain: Domain;
  resolution: DomainsResolution;
  shouldOverrideOverlayImage?: boolean;
}): Promise<void> => {
  const {
    socialPicture,
    domain,
    resolution,
    shouldOverrideOverlayImage = false,
  } = options;

  if (!isNotEmpty(socialPicture)) {
    logger.warn(
      'trying to cache NFT picture with empty token URI, domain:',
      domain?.name,
    );
    return;
  }
  const fileName = getNFTFilenameInCDN(socialPicture);
  const fileNameWithOverlay = getNFTFilenameInCDN(socialPicture, domain.name);
  const bucketName = env.CLOUD_STORAGE.CLIENT_ASSETS.BUCKET_ID;
  const bucket = storage.bucket(bucketName);

  const [fileExists] = await bucket.file(fileName).exists();
  const [fileWithOverlayExists] = await bucket
    .file(fileNameWithOverlay)
    .exists();

  const shouldWriteOverlayImage =
    shouldOverrideOverlayImage || !fileWithOverlayExists;

  if (!fileExists || shouldWriteOverlayImage) {
    // TODO: Refactor this code
    // (1) Why are there function declarations inside of function declarations?
    // (2) In the meantime, just instantiate a service as a stop gap
    // (3) Are there no tests around these methods?
    const { fetchedMetadata, image } = await new MetadataService(
      null,
      null,
    ).fetchTokenMetadata(resolution);
    const [imageData, mimeType] = await getNFTSocialPicture(image).catch(() => [
      '',
      null,
    ]);

    // upload images to bucket
    if (imageData) {
      type ImageFile = { fname: string; data: string };
      const files: Array<ImageFile> = [];

      if (!fileExists) {
        const imageDataSVG = simpleSVGTemplate(
          `data:${mimeType};base64,${imageData}`,
        );
        files.push({ fname: fileName, data: imageDataSVG });
      }

      if (shouldWriteOverlayImage) {
        const withOverlayImageData = createSocialPictureImage(
          domain,
          imageData,
          mimeType,
          fetchedMetadata?.background_color || '',
          true,
        );
        files.push({ fname: fileNameWithOverlay, data: withOverlayImageData });
      }

      // @TODO: this actually doesn't wait for uploading to finish. Re-do so we wait
      // temporarity replaced Promise.all() with seqential execution instead of parallel
      for (const file of files) {
        await uploadSVG(file.fname, file.data);
      }
    } else {
      logger.error(
        `Failed to generate image data for the domain: ${JSON.stringify(
          domain,
        )}, token URI: ${socialPicture}`,
      );
    }
  }

  async function uploadSVG(fileName: string, imageData: string) {
    const file = bucket.file(fileName);
    // cache in the storage
    const imageBuffer = Buffer.from(imageData);
    await file.save(imageBuffer, {
      metadata: {
        contentType: 'image/svg+xml',
      },
    });
  }
};

/**
 * Check if the social picture is cached in CDN
 */
export const checkNftPfpImageExistFromCDN = async (
  socialPicTokenURI: string,
  withOverlayDomain?: string,
): Promise<boolean> => {
  if (!isNotEmpty(socialPicTokenURI)) {
    return false;
  }
  const fileName = getNFTFilenameInCDN(socialPicTokenURI, withOverlayDomain);
  const bucketName = env.CLOUD_STORAGE.CLIENT_ASSETS.BUCKET_ID;
  const bucket = storage.bucket(bucketName);

  const [fileExists] = await bucket.file(fileName).exists();

  return fileExists;
};

/**
 * Returns a social picture data string cached in CDN or null if image is not found in CDN cache.
 */
export const getNftPfpImageFromCDN = async (
  socialPicTokenURI: string,
  withOverlayDomain?: string,
): Promise<string | null> => {
  if (!isNotEmpty(socialPicTokenURI)) {
    return null;
  }
  const fileName = getNFTFilenameInCDN(socialPicTokenURI, withOverlayDomain);
  const bucketName = env.CLOUD_STORAGE.CLIENT_ASSETS.BUCKET_ID;
  // const hostname = env.CLOUD_STORAGE.API_ENDPOINT_URL || 'https://storage.googleapis.com';
  const bucket = storage.bucket(bucketName);

  const [fileExists] = await bucket.file(fileName).exists();
  if (fileExists) {
    const contents = await bucket.file(fileName).download();
    return contents.toString(); // maybe replace this with stream buffer in the future
  } else {
    return null;
  }
};

export const toBase64DataURI = (svg: string): string => {
  // maybe use Buffer.from(data).toString('base64') instead of btoa(), which is deprecated in nodejs
  return (
    'data:image/svg+xml;base64,' +
    btoa(
      encodeURIComponent(svg).replace(/%([0-9A-F]{2})/g, function (match, p1) {
        return String.fromCharCode(parseInt(p1, 16));
      }),
    )
  );
};

const isNotEmpty = (str: string) => {
  return Boolean(str?.trim());
};

export const getOffChainProfileImage = async (
  domain: Domain,
  overlay: boolean,
): Promise<string | null> => {
  const url = `${env.PROFILE_API_URL}/${domain.name}`;
  let response;

  try {
    response = await (
      await nodeFetch(url, { timeout: PROFILE_FETCH_TIMEOUT_MS })
    ).json();
  } catch (error) {
    logger.error(`Failed to fetch offchain profile for: ${url}`);
    logger.error(`Profile Fetching error: ${error}`);
    return null;
  }

  if (response.profile?.imageType !== 'offChain') {
    return null;
  }

  let base64,
    mimeType = null;
  try {
    [base64, mimeType] = await getNFTSocialPicture(response.profile?.imagePath);

    if (!mimeType || !base64) {
      logger.error('Unable to determine image data');
      return null;
    }
  } catch (error) {
    logger.error(error);
    return null;
  }

  let profileImageSVG = offChainSVGTemplate(
    base64,
    mimeType,
    domain,
    DEFAULT_OVERLAY_FONTSIZE,
  );
  if (!overlay) {
    profileImageSVG = offChainSVGTemplate(
      base64,
      mimeType,
      domain,
      DEFAULT_OVERLAY_FONTSIZE,
      false,
    );
  }

  return profileImageSVG;
};

export const getOnChainProfileImage = async (
  imagePathFromDomain: string | undefined,
): Promise<string> => {
  let profileImageSVG = '';
  if (
    imagePathFromDomain &&
    imagePathFromDomain.startsWith(
      'https://cdn.unstoppabledomains.com/bucket/',
    ) &&
    imagePathFromDomain.endsWith('.svg')
  ) {
    try {
      const ret = await nodeFetch(imagePathFromDomain, {
        timeout: PROFILE_FETCH_TIMEOUT_MS,
      });
      profileImageSVG = await ret.text();
    } catch (error) {
      logger.error(
        `Failed to generate image data from the following endpoint: ${imagePathFromDomain}`,
      );
      logger.error(error);
      return profileImageSVG;
    }
  }

  return profileImageSVG;
};
