import "server-only";
import { productMediaRepository } from "../repositories/product-media.repository";
import { productRepository } from "../repositories/product.repository";
import type { ProductMediaInput } from "../validators/product.schema";
import { productMediaSchema } from "../validators/product.schema";
import { ProductNotFoundError } from "./product.service";

/**
 * ProductMedia service — media attached to a product.
 *
 * Upload flow is interface-prepared (see `media-storage.ts`): today media is
 * attached by URL; the pre-signed upload provider lands in a future PR
 * without changing this service's API.
 */
export const productMediaService = {
  list(organizationId: string, productId: string) {
    return productMediaRepository.listByProduct(organizationId, productId);
  },

  async add(organizationId: string, productId: string, input: ProductMediaInput) {
    const data = productMediaSchema.parse(input);

    const product = await productRepository.findById(organizationId, productId);
    if (!product) throw new ProductNotFoundError();

    if (data.isPrimary) {
      await productMediaRepository.clearPrimary(organizationId, productId);
    }

    const media = await productMediaRepository.create(organizationId, {
      productId,
      type: data.type,
      url: data.url,
      altText: data.altText ?? null,
      position: data.position,
      isPrimary: data.isPrimary,
    });

    // Keep the product's cover image in sync with the primary media.
    if (data.isPrimary || !product.imageUrl) {
      await productRepository.update(organizationId, productId, { imageUrl: data.url });
    }

    return media;
  },

  async setPrimary(organizationId: string, mediaId: string) {
    const media = await productMediaRepository.findById(organizationId, mediaId);
    if (!media) throw new ProductNotFoundError();

    await productMediaRepository.clearPrimary(organizationId, media.productId);
    const updated = await productMediaRepository.update(organizationId, mediaId, {
      isPrimary: true,
    });
    await productRepository.update(organizationId, media.productId, { imageUrl: media.url });
    return updated;
  },

  async remove(organizationId: string, mediaId: string) {
    const media = await productMediaRepository.findById(organizationId, mediaId);
    if (!media) throw new ProductNotFoundError();

    await productMediaRepository.delete(organizationId, mediaId);

    // If the cover pointed at this media, fall back to the next one.
    const product = await productRepository.findById(organizationId, media.productId);
    if (product && product.imageUrl === media.url) {
      const remaining = await productMediaRepository.listByProduct(organizationId, media.productId);
      await productRepository.update(organizationId, media.productId, {
        imageUrl: remaining[0]?.url ?? null,
      });
    }
  },
};
