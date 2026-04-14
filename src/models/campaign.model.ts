import prisma from '@/config/database';

import { v4 as uuidv4 } from 'uuid';
import {
  Campaign,
  CampaignRequirements,
  CampaignStatus,
  CreateCampaignInput,
  UpdateCampaignInput,
} from '@/types/campaign';
import { NotFoundError, DatabaseError } from '@/utils/errors';
import logger from '@/utils/logger';

/**
 * Campaign Model - CRUD Operations
 */
export const CampaignModel = {
  /**
   * Create a new campaign
   */
  async create(data: CreateCampaignInput): Promise<Campaign> {
    try {
      const now = new Date();

      const campaign = await prisma.campaigns.create({
        data: {
          id: uuidv4(),
          brandId: data.brandId,
          title: data.title,
          description: data.description ?? '',
          budget: 0,

          startDate:
            typeof data.startDate === 'string'
              ? new Date(data.startDate)
              : data.startDate,
          endDate:
            typeof data.endDate === 'string'
              ? new Date(data.endDate)
              : data.endDate,
          type: 'UGC',
          platforms: '[]',
          updatedAt: now,
        },
      });

      logger.info(`Campaign created: ${campaign.id}`);
      return this.mapToCampaign(campaign);
    } catch (error) {
      logger.error({ error }, 'Error creating campaign');
      throw new DatabaseError('Failed to create campaign', error);
    }
  },

  /**
   * Find campaign by ID
   */
  async findById(id: string): Promise<Campaign | null> {
    try {
      const campaign = await prisma.campaigns.findUnique({
        where: { id },
      });

      return campaign ? this.mapToCampaign(campaign) : null;
    } catch (error) {
      logger.error({ error }, 'Error finding campaign');
      throw new DatabaseError('Failed to find campaign', error);
    }
  },

  async findByIdOrThrow(id: string): Promise<Campaign> {
    const campaign = await this.findById(id);
    if (!campaign) {
      throw new NotFoundError('Campaign', id);
    }
    return campaign;
  },

  async findAll(options: {
    page?: number;
    limit?: number;
    brandId?: string;
  } = {}): Promise<{ campaigns: Campaign[]; total: number }> {
    try {
      const { page = 1, limit = 20, brandId } = options;
      const skip = (page - 1) * limit;

      const where: any = {};
      if (brandId) where.brandId = brandId;

      const [campaigns, total] = await Promise.all([
        prisma.campaigns.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.campaigns.count({ where }),
      ]);

      return {
        campaigns: campaigns.map(this.mapToCampaign),
        total,
      };
    } catch (error) {
      logger.error({ error }, 'Error finding campaigns');
      throw new DatabaseError('Failed to find campaigns', error);
    }
  },

  async update(id: string, data: UpdateCampaignInput): Promise<Campaign> {
    try {
      const campaign = await prisma.campaigns.update({
        where: { id },
        data: {
          title: data.title,

          description:
            data.description !== undefined ? data.description : undefined,

          startDate:
            typeof data.startDate === 'string'
              ? new Date(data.startDate)
              : data.startDate,

          endDate:
            typeof data.endDate === 'string'
              ? new Date(data.endDate)
              : data.endDate,
          updatedAt: new Date(),
        },
      });

      logger.info(`Campaign updated: ${id}`);
      return this.mapToCampaign(campaign);
    } catch (error: any) {
      if (error.code === 'P2025') {
        throw new NotFoundError('Campaign', id);
      }
      logger.error({ error }, 'Error updating campaign');
      throw new DatabaseError('Failed to update campaign', error);
    }
  },

  async delete(id: string): Promise<void> {
    try {
      await prisma.campaigns.delete({
        where: { id },
      });
      logger.info(`Campaign deleted: ${id}`);
    } catch (error: any) {
      if (error.code === 'P2025') {
        throw new NotFoundError('Campaign', id);
      }
      logger.error({ error }, 'Error deleting campaign');
      throw new DatabaseError('Failed to delete campaign', error);
    }
  },

  /**
   * Map Prisma → API Campaign type
   */
  mapToCampaign(campaign: any): Campaign {
    const status: CampaignStatus =
      typeof campaign.status === 'string'
        ? (CampaignStatus[campaign.status.toUpperCase() as keyof typeof CampaignStatus] ??
           CampaignStatus.DRAFT)
        : CampaignStatus.DRAFT;

    return {
      id: campaign.id,
      brandId: campaign.brandId,
      brandName: campaign.brandName,
      title: campaign.title,
      description: campaign.description || undefined,
      // Requirements are not yet persisted in the current Prisma schema.
      // Default to an empty requirements object for now.
      requirements:
        (campaign as any).requirements ??
        ({} as CampaignRequirements),
      status,
      startDate: campaign.startDate,
      endDate: campaign.endDate,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
    };
  },
};
