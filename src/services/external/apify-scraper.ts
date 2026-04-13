import axios, { AxiosInstance } from 'axios';
import { externalApiConfig, isApiConfigured } from '@/config/external-apis';
import { ExternalApiError, RateLimitError } from '@/utils/errors';
import { normalizeReelUrlCanonical } from '@/utils/validation';
import logger from '@/utils/logger';

/**
 * Scraped Profile Data (comprehensive from all Apify scrapers)
 */
export interface ScrapedProfile {
  username: string;
  fullName: string | null;
  biography: string | null;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  profilePictureUrl: string | null;
  isVerified: boolean;
  isPrivate: boolean;
  externalUrl: string | null;
  // Additional fields from Profile Scraper
  profileId?: string | null;
  profileUrl?: string | null;
  location?: string | null;
  usernameChangeCount?: number | null;
  joinDate?: Date | null;
  isRecentlyJoined?: boolean | null;
  videoCount?: number | null;
  highlightReelsCount?: number | null;
  facebookId?: string | null;
  verifiedDate?: Date | null;
  isBusinessAccount?: boolean | null;
  businessCategory?: string | null;
  relatedProfiles?: string[];
  latestPosts?: Array<{
    id: string;
    url: string;
    caption: string | null;
    likes: number;
    comments: number;
    timestamp: Date;
    type: string;
  }>;
  igtvVideoCount?: number | null;
  latestIgtvVideos?: Array<{
    id: string;
    url: string;
    caption: string | null;
    views: number;
    timestamp: Date;
  }>;
}

/**
 * Scraped Reel Data (from Apify Instagram Reel Scraper)
 */
export interface ScrapedReel {
  id: string;
  shortcode: string;
  url: string;
  caption: string | null;
  transcript: string | null;
  likeCount: number;
  commentCount: number;
  playCount: number | null;
  shareCount: number | null;
  timestamp: Date;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  duration: number | null;
  hashtags: string[];
  mentions: string[];
  taggedUsers: string[];
  comments: Array<{
    id?: string;
    commentUrl?: string;
    text: string;
    author: string;
    ownerUsername?: string;
    ownerProfilePicUrl?: string;
    timestamp: Date;
    likes?: number;
    likesCount?: number;
    repliesCount?: number;
    replies?: Array<{
      id?: string;
      text: string;
      author: string;
      ownerUsername?: string;
      ownerProfilePicUrl?: string;
      timestamp: Date;
      likes?: number;
      likesCount?: number;
      repliesCount?: number;
    }>;
    owner?: {
      id?: string;
      username?: string;
      fullName?: string;
      profilePicUrl?: string;
      isVerified?: boolean;
      isPrivate?: boolean;
    };
  }>;
  ownerUsername: string | null;
  ownerFullName: string | null;
  musicInfo: {
    artist: string | null;
    song: string | null;
    originalAudio: boolean;
  } | null;
  isSponsored: boolean;
  commentsDisabled: boolean;
  coAuthors: string[];
  mediaDimensions: {
    width: number | null;
    height: number | null;
  } | null;
  // Additional fields from Post Scraper
  postType?: string | null;
  isPinned?: boolean | null;
  isPaidPartnership?: boolean | null;
  childPosts?: Array<{
    id: string;
    url: string;
    imageUrl: string | null;
    caption: string | null;
  }>;
  imageUrls?: string[];
  imageAltText?: string[];
  imageDimensions?: Array<{
    width: number | null;
    height: number | null;
  }>;
  replyCount?: number | null;
  postOwnerInfo?: {
    username: string | null;
    fullName: string | null;
    profilePicUrl: string | null;
    followers?: number | null;
    following?: number | null;
  } | null;
}

/**
 * Apify Scraper Client
 */
class ApifyScraperClient {
  private client: AxiosInstance;
  private apiToken: string | null;

  constructor() {
    this.apiToken = externalApiConfig.apify.apiToken || null;
    
    this.client = axios.create({
      baseURL: externalApiConfig.apify.baseUrl,
      timeout: 60000, // Longer timeout for scraping
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiToken && { Authorization: `Bearer ${this.apiToken}` }),
      },
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 429) {
          throw new RateLimitError('Apify', error.response.headers['retry-after']);
        }
        if (error.response) {
          throw new ExternalApiError(
            'Apify',
            error.response.data?.error?.message || error.message,
            error
          );
        }
        throw new ExternalApiError('Apify', error.message, error);
      }
    );
  }

  /**
   * Check if Apify is configured
   */
  isConfigured(): boolean {
    return isApiConfigured('apify');
  }

  /**
   * Scrape Instagram profile using multiple Apify scrapers:
   * 1. Instagram Profile Scraper (specialized for profiles)
   * 2. Instagram Scraper (general scraper)
   * Combines results from both for comprehensive data
   */
  async scrapeProfile(username: string): Promise<ScrapedProfile> {
    try {
      if (!this.isConfigured()) {
        logger.warn('Apify not configured, returning mock scraped data');
        return this.getMockProfile(username);
      }

      logger.info(`Scraping profile using Apify scrapers (Profile Scraper + Instagram Scraper): ${username}`);

      if (!this.apiToken) {
        throw new Error('Apify API token is not configured');
      }

      let profileScraperData: any = null;
      let instagramScraperData: any = null;

      // Try Instagram Profile Scraper first (specialized for profiles)
      try {
        logger.info('Trying Apify Instagram Profile Scraper...');
        const profileActorId = 'apify~instagram-profile-scraper';
        const profileInput = {
          usernames: [username],
          includeAboutSection: true, // Get join date, verification date, etc.
        };

        const profileResponse = await this.client.post(
          `/acts/${profileActorId}/run-sync-get-dataset-items`,
          profileInput,
          {
            params: {
              token: this.apiToken,
              format: 'json',
            },
            timeout: 120000,
          }
        );

        const profileDatasetItems = profileResponse.data || [];
        if (profileDatasetItems && profileDatasetItems.length > 0) {
          profileScraperData = profileDatasetItems[0];
          logger.info('Instagram Profile Scraper completed successfully');
        }
      } catch (error: any) {
        logger.warn({ error: error.message }, 'Instagram Profile Scraper failed, trying Instagram Scraper');
      }

      // Try general Instagram Scraper as fallback/supplement
      try {
        logger.info('Trying Apify Instagram Scraper...');
        const instagramActorId = 'apify~instagram-scraper';
        const instagramInput = {
          directUrls: [`https://www.instagram.com/${username}/`],
          resultsType: 'details', // Get profile details
          resultsLimit: 1,
          addParentData: false,
        };

        const instagramResponse = await this.client.post(
          `/acts/${instagramActorId}/run-sync-get-dataset-items`,
          instagramInput,
          {
            params: {
              token: this.apiToken,
              format: 'json',
            },
            timeout: 120000,
          }
        );

        const instagramDatasetItems = instagramResponse.data || [];
        if (instagramDatasetItems && instagramDatasetItems.length > 0) {
          instagramScraperData = instagramDatasetItems[0];
          logger.info('Instagram Scraper completed successfully');
        }
      } catch (error: any) {
        logger.warn({ error: error.message }, 'Instagram Scraper failed');
      }

      // Combine data from both sources, prioritizing Profile Scraper data
      if (!profileScraperData && !instagramScraperData) {
        logger.warn('No profile data found from either Apify scraper, returning mock data');
        return this.getMockProfile(username);
      }

      // Merge data from both sources
      return this.mapApifyProfileData(profileScraperData || instagramScraperData, username, instagramScraperData);
    } catch (error: any) {
      logger.error({ 
        error: error.message,
        stack: error.stack,
        username 
      }, 'Error scraping profile with Apify');
      
      // Fallback to mock data on error
      return this.getMockProfile(username);
    }
  }

  /**
   * Map Apify profile data to our ScrapedProfile interface
   * Combines data from Profile Scraper and Instagram Scraper
   */
  private mapApifyProfileData(primaryData: any, username: string, secondaryData?: any): ScrapedProfile {
    // Use primary data (Profile Scraper) as base, fill gaps with secondary data (Instagram Scraper)
    const profileData = primaryData || secondaryData || {};
    const fallbackData = secondaryData || {};

    // Extract latest posts (from Profile Scraper)
    const latestPosts = (profileData.latestPosts || profileData.posts || []).slice(0, 12).map((post: any) => ({
      id: post.id || post.shortcode || '',
      url: post.url || post.permalink || '',
      caption: post.caption || post.text || null,
      likes: post.likesCount || post.likes || post.likeCount || 0,
      comments: post.commentsCount || post.comments || post.commentCount || 0,
      timestamp: post.timestamp ? new Date(post.timestamp) : new Date(),
      type: post.type || post.mediaType || 'unknown',
    }));

    // Extract latest IGTV videos
    const latestIgtvVideos = (profileData.latestIgtvVideos || profileData.igtvVideos || []).slice(0, 12).map((video: any) => ({
      id: video.id || video.shortcode || '',
      url: video.url || video.permalink || '',
      caption: video.caption || video.text || null,
      views: video.viewsCount || video.views || video.playCount || 0,
      timestamp: video.timestamp ? new Date(video.timestamp) : new Date(),
    }));

    // Extract related profiles
    const relatedProfiles = [
      ...(profileData.relatedProfiles || []),
      ...(fallbackData.relatedProfiles || [])
    ];
    const uniqueRelatedProfiles = Array.from(new Set(relatedProfiles));

    // Extract external URL from externalUrls array if available
    const externalUrl = profileData.externalUrl || 
      (profileData.externalUrls && profileData.externalUrls.length > 0 ? profileData.externalUrls[0].url : null) ||
      fallbackData.externalUrl || 
      profileData.external_url || 
      fallbackData.external_url || 
      profileData.website || 
      fallbackData.website || 
      null;

    // Extract related profiles usernames from the array
    const relatedProfilesUsernames = uniqueRelatedProfiles.map((profile: any) => {
      if (typeof profile === 'string') {
        return profile;
      }
      // Handle object format - could be {username: "..."} or {username: "...", ...}
      return profile?.username || null;
    }).filter((username: string | null) => username !== null);

    return {
      username: profileData.username || fallbackData.username || profileData.ownerUsername || username,
      fullName: profileData.fullName || fallbackData.fullName || profileData.full_name || null,
      biography: profileData.biography || fallbackData.biography || profileData.bio || fallbackData.bio || profileData.description || null,
      followersCount: profileData.followersCount || fallbackData.followersCount || profileData.followers || fallbackData.followers || profileData.followerCount || 0,
      followingCount: profileData.followsCount || profileData.followingCount || fallbackData.followsCount || fallbackData.followingCount || profileData.following || fallbackData.following || 0,
      postsCount: profileData.postsCount || fallbackData.postsCount || profileData.posts || fallbackData.posts || profileData.mediaCount || fallbackData.mediaCount || profileData.postCount || 0,
      profilePictureUrl: profileData.profilePicUrlHD || profileData.profilePicUrl || profileData.profilePictureUrl || fallbackData.profilePicUrlHD || fallbackData.profilePicUrl || fallbackData.profilePictureUrl || profileData.profilePicUrlHd || null,
      isVerified: profileData.verified !== undefined ? profileData.verified : (profileData.isVerified !== undefined ? profileData.isVerified : (fallbackData.verified !== undefined ? fallbackData.verified : (fallbackData.isVerified !== undefined ? fallbackData.isVerified : (profileData.is_verified || false)))),
      isPrivate: profileData.private !== undefined ? profileData.private : (profileData.isPrivate !== undefined ? profileData.isPrivate : (fallbackData.private !== undefined ? fallbackData.private : (fallbackData.isPrivate !== undefined ? fallbackData.isPrivate : (profileData.is_private || false)))),
      externalUrl: externalUrl,
      // Additional fields from Profile Scraper
      profileId: profileData.profileId || fallbackData.profileId || profileData.id || fallbackData.id || null,
      profileUrl: profileData.profileUrl || fallbackData.profileUrl || profileData.url || fallbackData.url || profileData.inputUrl || `https://www.instagram.com/${username}/`,
      location: profileData.location || fallbackData.location || null,
      usernameChangeCount: profileData.usernameChangeCount !== undefined ? profileData.usernameChangeCount : (fallbackData.usernameChangeCount !== undefined ? fallbackData.usernameChangeCount : null),
      joinDate: profileData.joinDate ? new Date(profileData.joinDate) : (fallbackData.joinDate ? new Date(fallbackData.joinDate) : null),
      isRecentlyJoined: profileData.joinedRecently !== undefined ? profileData.joinedRecently : (profileData.isRecentlyJoined !== undefined ? profileData.isRecentlyJoined : (fallbackData.joinedRecently !== undefined ? fallbackData.joinedRecently : (fallbackData.isRecentlyJoined !== undefined ? fallbackData.isRecentlyJoined : null))),
      videoCount: profileData.videoCount !== undefined ? profileData.videoCount : (fallbackData.videoCount !== undefined ? fallbackData.videoCount : null),
      highlightReelsCount: profileData.highlightReelCount !== undefined ? profileData.highlightReelCount : (profileData.highlightReelsCount !== undefined ? profileData.highlightReelsCount : (fallbackData.highlightReelCount !== undefined ? fallbackData.highlightReelCount : (fallbackData.highlightReelsCount !== undefined ? fallbackData.highlightReelsCount : null))),
      facebookId: profileData.facebookId || profileData.fbid || fallbackData.facebookId || fallbackData.fbid || null,
      verifiedDate: profileData.verifiedDate ? new Date(profileData.verifiedDate) : (fallbackData.verifiedDate ? new Date(fallbackData.verifiedDate) : null),
      isBusinessAccount: profileData.isBusinessAccount !== undefined ? profileData.isBusinessAccount : (fallbackData.isBusinessAccount !== undefined ? fallbackData.isBusinessAccount : (profileData.is_business_account || null)),
      businessCategory: profileData.businessCategoryName || profileData.businessCategory || fallbackData.businessCategoryName || fallbackData.businessCategory || profileData.business_category || null,
      relatedProfiles: relatedProfilesUsernames.length > 0 ? relatedProfilesUsernames : undefined,
      latestPosts: latestPosts.length > 0 ? latestPosts : undefined,
      igtvVideoCount: profileData.igtvVideoCount !== undefined ? profileData.igtvVideoCount : (fallbackData.igtvVideoCount !== undefined ? fallbackData.igtvVideoCount : null),
      latestIgtvVideos: latestIgtvVideos.length > 0 ? latestIgtvVideos : undefined,
    };
  }

  /**
   * Scrape Instagram reel using all available Apify scrapers:
   * 1. Instagram Reel Scraper (specialized for reels)
   * 2. Instagram Post Scraper (specialized for posts/reels)
   * 3. Instagram Scraper (general scraper)
   * Combines results from all APIs for maximum data coverage
   */
  async scrapeReel(reelUrl: string): Promise<ScrapedReel> {
    const normalizedReelUrl = normalizeReelUrlCanonical(reelUrl) || reelUrl.trim();
    try {
      if (!this.isConfigured()) {
        logger.warn('Apify not configured, returning mock scraped data');
        return this.getMockReel(normalizedReelUrl);
      }

      logger.info(`Scraping reel using Apify (Reel Scraper + Post Scraper + Instagram Scraper): ${normalizedReelUrl}`);

      if (!this.apiToken) {
        throw new Error('Apify API token is not configured');
      }

      let reelScraperData: any = null;
      let postScraperData: any = null;
      let instagramScraperData: any = null;

      // Try Instagram Reel Scraper first (specialized for reels)
      try {
        logger.info('Trying Apify Instagram Reel Scraper...');
        const reelActorId = 'apify~instagram-reel-scraper';
        const reelInput = {
          username: [normalizedReelUrl],
          includeTranscript: true,
          includeDownloadedVideo: false,
          includeSharesCount: true,
          resultsLimit: 1,
        };

        const reelResponse = await this.client.post(
          `/acts/${reelActorId}/run-sync-get-dataset-items`,
          reelInput,
          {
            params: {
              token: this.apiToken,
              format: 'json',
            },
            timeout: 120000,
          }
        );

        const reelDatasetItems = reelResponse.data || [];
        if (reelDatasetItems && reelDatasetItems.length > 0) {
          reelScraperData = reelDatasetItems[0];
          logger.info('Instagram Reel Scraper completed successfully');
        }
      } catch (error: any) {
        logger.warn({ error: error.message }, 'Instagram Reel Scraper failed, trying other scrapers');
      }

      // Try Instagram Post Scraper (specialized for posts/reels)
      try {
        logger.info('Trying Apify Instagram Post Scraper...');
        const postActorId = 'apify~instagram-post-scraper';
        const postInput = {
          username: [normalizedReelUrl],
          resultsLimit: 1,
          skipPinnedPosts: false,
        };

        const postResponse = await this.client.post(
          `/acts/${postActorId}/run-sync-get-dataset-items`,
          postInput,
          {
            params: {
              token: this.apiToken,
              format: 'json',
            },
            timeout: 120000,
          }
        );

        const postDatasetItems = postResponse.data || [];
        if (postDatasetItems && postDatasetItems.length > 0) {
          postScraperData = postDatasetItems[0];
          logger.info('Instagram Post Scraper completed successfully');
        }
      } catch (error: any) {
        logger.warn({ error: error.message }, 'Instagram Post Scraper failed, trying other scrapers');
      }

      // Try general Instagram Scraper (can also scrape reels)
      try {
        logger.info('Trying Apify Instagram Scraper...');
        const instagramActorId = 'apify~instagram-scraper';
        const instagramInput = {
          directUrls: [normalizedReelUrl],
          resultsType: 'posts', // Get post/reel details
          resultsLimit: 1,
          addParentData: false,
        };

        const instagramResponse = await this.client.post(
          `/acts/${instagramActorId}/run-sync-get-dataset-items`,
          instagramInput,
          {
            params: {
              token: this.apiToken,
              format: 'json',
            },
            timeout: 120000,
          }
        );

        const instagramDatasetItems = instagramResponse.data || [];
        if (instagramDatasetItems && instagramDatasetItems.length > 0) {
          instagramScraperData = instagramDatasetItems[0];
          logger.info('Instagram Scraper completed successfully');
        }
      } catch (error: any) {
        logger.warn({ error: error.message }, 'Instagram Scraper failed');
      }

      // Try Instagram Comments Scraper for comprehensive comment data (needed for reel authenticity verification)
      let commentsScraperData: any[] = [];
      try {
        logger.info(`Trying Apify Instagram Comments Scraper for URL: ${reelUrl}`);
        const commentsActorId = 'apify~instagram-comment-scraper';
        const COMMENT_LIMIT_PER_POST = 200; // Request enough for authenticity/bot detection; official actor defaults to 15 if not set
        const commentsInput = {
          directUrls: [normalizedReelUrl],
          resultsLimit: COMMENT_LIMIT_PER_POST, // Official apify/instagram-comment-scraper uses this (default 15)
          post_urls: [normalizedReelUrl], // Some store actors (e.g. dead00) expect post_urls
          comment_limit: COMMENT_LIMIT_PER_POST,
          maxCommentsPerPost: COMMENT_LIMIT_PER_POST,
        };

        logger.info({ input: commentsInput }, 'Calling Comments Scraper API');
        const commentsResponse = await this.client.post(
          `/acts/${commentsActorId}/run-sync-get-dataset-items`,
          commentsInput,
          {
            params: {
              token: this.apiToken,
              format: 'json',
            },
            timeout: 120000,
          }
        );

        logger.info(`Comments Scraper response status: ${commentsResponse.status}`);
        logger.info(`Comments Scraper response data type: ${typeof commentsResponse.data}, is array: ${Array.isArray(commentsResponse.data)}`);
        
        // Handle different response structures
        let commentsDatasetItems: any[] = [];
        if (Array.isArray(commentsResponse.data)) {
          commentsDatasetItems = commentsResponse.data;
        } else if (commentsResponse.data && Array.isArray(commentsResponse.data.items)) {
          commentsDatasetItems = commentsResponse.data.items;
        } else if (commentsResponse.data && commentsResponse.data.data && Array.isArray(commentsResponse.data.data)) {
          commentsDatasetItems = commentsResponse.data.data;
        } else if (commentsResponse.data) {
          // Try to extract array from response
          const data = commentsResponse.data;
          if (data.length !== undefined) {
            commentsDatasetItems = Array.from(data);
          }
        }

        logger.info(`Extracted ${commentsDatasetItems.length} comments from Comments Scraper`);
        
        if (commentsDatasetItems && commentsDatasetItems.length > 0) {
          commentsScraperData = commentsDatasetItems;
          logger.info(`Instagram Comments Scraper completed successfully, found ${commentsDatasetItems.length} comments`);
          // Log first comment structure for debugging
          if (commentsDatasetItems[0]) {
            logger.info({ sampleComment: commentsDatasetItems[0] }, 'Sample comment structure from Comments Scraper');
          }
        } else {
          logger.warn('Comments Scraper returned empty or invalid data structure');
        }
      } catch (error: any) {
        logger.error({ 
          error: error.message,
          stack: error.stack,
          response: error.response?.data 
        }, 'Instagram Comments Scraper failed, using comments from other scrapers');
      }

      // Combine data from all sources
      if (!reelScraperData && !postScraperData && !instagramScraperData) {
        logger.warn('No reel data found from any Apify scraper, returning mock data');
        return this.getMockReel(normalizedReelUrl);
      }

      // Merge data from all sources, prioritizing specialized scrapers
      return this.mapApifyReelData(
        reelScraperData || postScraperData || instagramScraperData, 
        normalizedReelUrl, 
        instagramScraperData,
        postScraperData,
        commentsScraperData
      );
    } catch (error: any) {
      logger.error({ 
        error: error.message,
        stack: error.stack,
        reelUrl: normalizedReelUrl 
      }, 'Error scraping reel with Apify');
      
      // Fallback to mock data on error
      return this.getMockReel(normalizedReelUrl);
    }
  }

  /**
   * Map Apify reel data to our ScrapedReel interface
   * Combines data from Reel Scraper, Post Scraper, Instagram Scraper, and Comments Scraper
   */
  private mapApifyReelData(
    primaryData: any, 
    reelUrl: string, 
    instagramScraperData?: any,
    postScraperData?: any,
    commentsScraperData?: any[]
  ): ScrapedReel {
    // Use primary data (Reel Scraper) as base, fill gaps with other scrapers
    const reelData = primaryData || {};
    const postData = postScraperData || {};
    const instagramData = instagramScraperData || {};
    
    // Merge all data sources
    const apifyData = { ...reelData, ...postData, ...instagramData };
    const reelId = this.extractReelId(reelUrl);
    
    // Extract comments from all sources
    // Prioritize Comments Scraper data (most comprehensive), then merge with other sources
    const commentsScraperComments = commentsScraperData || [];
    const reelComments = reelData.comments || [];
    const postComments = postData.comments || postData.commentsData || [];
    const instagramComments = instagramData.comments || [];
    
    // Create a map to deduplicate comments by ID or text+author
    const commentsMap = new Map<string, any>();
    
    // First, add Comments Scraper data (most comprehensive)
    commentsScraperComments.forEach((comment: any) => {
      const key = comment.id || `${comment.text}-${comment.ownerUsername}`;
      if (!commentsMap.has(key)) {
        commentsMap.set(key, comment);
      }
    });
    
    // Then add comments from other sources (fill gaps)
    [...reelComments, ...postComments, ...instagramComments].forEach((comment: any) => {
      const key = comment.id || `${comment.text || comment.commentText || comment.comment}-${comment.ownerUsername || comment.author || comment.username}`;
      if (!commentsMap.has(key)) {
        commentsMap.set(key, comment);
      }
    });
    
    // Keep up to 200 unique comments for engagement/authenticity analysis (more comments = better reel verification)
    const uniqueComments = Array.from(commentsMap.values()).slice(0, 200);
    
    logger.info({ 
      commentsScraperCount: commentsScraperComments.length,
      otherSourcesCount: reelComments.length + postComments.length + instagramComments.length,
      totalUniqueComments: uniqueComments.length
    }, 'Comment aggregation summary');

    const comments = uniqueComments.map((comment: any) => {
      // Map replies recursively
      const mapReplies = (replies: any[]): any[] => {
        if (!replies || !Array.isArray(replies)) return [];
        return replies.map((reply: any) => ({
          id: reply.id || undefined,
          text: reply.text || reply.commentText || reply.comment || '',
          author: reply.ownerUsername || reply.author || reply.username || 'unknown',
          ownerUsername: reply.ownerUsername || reply.author || reply.username || undefined,
          ownerProfilePicUrl: reply.ownerProfilePicUrl || reply.owner?.profile_pic_url || undefined,
          timestamp: reply.timestamp ? new Date(reply.timestamp) : new Date(),
          likes: reply.likesCount || reply.likes || reply.likeCount || undefined,
          likesCount: reply.likesCount || reply.likes || reply.likeCount || undefined,
          repliesCount: reply.repliesCount || undefined,
          owner: reply.owner ? {
            id: reply.owner.id || undefined,
            username: reply.owner.username || undefined,
            fullName: reply.owner.full_name || reply.owner.fullName || undefined,
            profilePicUrl: reply.owner.profile_pic_url || reply.owner.profilePicUrl || undefined,
            isVerified: reply.owner.is_verified !== undefined ? reply.owner.is_verified : (reply.owner.isVerified !== undefined ? reply.owner.isVerified : undefined),
            isPrivate: reply.owner.is_private !== undefined ? reply.owner.is_private : (reply.owner.isPrivate !== undefined ? reply.owner.isPrivate : undefined),
          } : undefined,
        }));
      };

      return {
        id: comment.id || undefined,
        commentUrl: comment.commentUrl || undefined,
        text: comment.text || comment.commentText || comment.comment || '',
        author: comment.ownerUsername || comment.author || comment.username || 'unknown',
        ownerUsername: comment.ownerUsername || comment.author || comment.username || undefined,
        ownerProfilePicUrl: comment.ownerProfilePicUrl || comment.ownerProfilePicUrl || comment.owner?.profile_pic_url || undefined,
        timestamp: comment.timestamp ? new Date(comment.timestamp) : new Date(),
        likes: comment.likesCount || comment.likes || comment.likeCount || undefined,
        likesCount: comment.likesCount || comment.likes || comment.likeCount || undefined,
        repliesCount: comment.repliesCount || (comment.replies && comment.replies.length > 0 ? comment.replies.length : undefined),
        replies: mapReplies(comment.replies || []),
        owner: comment.owner ? {
          id: comment.owner.id || undefined,
          username: comment.owner.username || undefined,
          fullName: comment.owner.full_name || comment.owner.fullName || undefined,
          profilePicUrl: comment.owner.profile_pic_url || comment.owner.profilePicUrl || undefined,
          isVerified: comment.owner.is_verified !== undefined ? comment.owner.is_verified : (comment.owner.isVerified !== undefined ? comment.owner.isVerified : undefined),
          isPrivate: comment.owner.is_private !== undefined ? comment.owner.is_private : (comment.owner.isPrivate !== undefined ? comment.owner.isPrivate : undefined),
        } : undefined,
      };
    });

    // Extract hashtags and mentions from caption (check all sources)
    const reelCaption = reelData.caption || reelData.text || null;
    const postCaption = postData.caption || postData.text || null;
    const instagramCaption = instagramData.caption || instagramData.text || null;
    const caption = reelCaption || postCaption || instagramCaption;
    
    const hashtagsFromCaption = caption ? (caption.match(/#\w+/g) || []).map((h: string) => h.substring(1)) : [];
    const mentionsFromCaption = caption ? (caption.match(/@\w+/g) || []).map((m: string) => m.substring(1)) : [];

    // Combine hashtags and mentions from all sources
    const hashtags = [
      ...(reelData.hashtags || []),
      ...(postData.hashtags || []),
      ...(instagramData.hashtags || []),
      ...hashtagsFromCaption
    ];
    const uniqueHashtags = Array.from(new Set(hashtags));

    const mentions = [
      ...(reelData.mentions || []),
      ...(postData.mentions || []),
      ...(instagramData.mentions || []),
      ...mentionsFromCaption
    ];
    const uniqueMentions = Array.from(new Set(mentions));

    // Combine tagged users from all sources
    const taggedUsers = [
      ...(reelData.taggedUsers || reelData.taggedProfiles || []),
      ...(postData.taggedUsers || postData.taggedProfiles || []),
      ...(instagramData.taggedUsers || instagramData.taggedProfiles || [])
    ];
    const uniqueTaggedUsers = Array.from(new Set(taggedUsers));

    // Extract child posts (from Post Scraper)
    const childPosts = (postData.childPosts || postData.children || []).map((child: any) => ({
      id: child.id || child.shortcode || '',
      url: child.url || child.permalink || '',
      imageUrl: child.imageUrl || child.displayUrl || child.image || null,
      caption: child.caption || child.text || null,
    }));

    // Extract image URLs and alt text (from Post Scraper)
    // Handle both array format and single image format
    const postImageUrls = Array.isArray(postData.imageUrls) ? postData.imageUrls : (postData.imageUrl ? [postData.imageUrl] : []);
    const postImages = Array.isArray(postData.images) ? postData.images : (postData.image ? [postData.image] : []);
    const reelImageUrls = Array.isArray(reelData.imageUrls) ? reelData.imageUrls : (reelData.imageUrl ? [reelData.imageUrl] : []);
    const imageUrls = [
      ...postImageUrls,
      ...postImages,
      ...reelImageUrls,
    ];
    
    // Handle alt text - could be array or single string
    const imageAltText = Array.isArray(postData.imageAltText) ? postData.imageAltText : 
                         (Array.isArray(postData.altText) ? postData.altText : 
                         (postData.altText ? [postData.altText] : []));
    
    // Handle dimensions - could be array or single object
    const postImageDims = Array.isArray(postData.imageDimensions) ? postData.imageDimensions : 
                          (postData.imageDimensions ? [postData.imageDimensions] : []);
    const postDims = Array.isArray(postData.dimensions) ? postData.dimensions : 
                     (postData.dimensions ? [postData.dimensions] : []);
    const imageDimensions = [...postImageDims, ...postDims].map((dim: any) => ({
      width: dim?.width || dim?.w || null,
      height: dim?.height || dim?.h || null,
    }));

    // Extract post owner info (from Post Scraper and other sources)
    const postOwnerInfo = postData.postOwnerInfo || postData.owner || reelData.owner || instagramData.owner ? {
      username: postData.postOwnerInfo?.username || postData.owner?.username || reelData.owner?.username || instagramData.owner?.username || postData.ownerUsername || reelData.ownerUsername || instagramData.ownerUsername || null,
      fullName: postData.postOwnerInfo?.fullName || postData.owner?.fullName || reelData.owner?.fullName || instagramData.owner?.fullName || postData.ownerFullName || reelData.ownerFullName || instagramData.ownerFullName || null,
      profilePicUrl: postData.postOwnerInfo?.profilePicUrl || postData.owner?.profilePicUrl || reelData.owner?.profilePicUrl || instagramData.owner?.profilePicUrl || null,
      followers: postData.postOwnerInfo?.followers || postData.owner?.followers || postData.ownerFollowers || reelData.owner?.followers || reelData.ownerFollowers || instagramData.owner?.followers || instagramData.ownerFollowers || null,
      following: postData.postOwnerInfo?.following || postData.owner?.following || postData.ownerFollowing || reelData.owner?.following || reelData.ownerFollowing || instagramData.owner?.following || instagramData.ownerFollowing || null,
    } : null;

    // Extract view count: Apify actors use various field names (viewsCount, viewCount, videoViewCount, views, playCount, etc.)
    const playCount = this.extractPlayCount(reelData, postData, instagramData);
    if (playCount == null || playCount === 0) {
      logger.warn(
        {
          reelUrl,
          reelDataViews: this.pickViewFields(reelData),
          postDataViews: this.pickViewFields(postData),
          instagramDataViews: this.pickViewFields(instagramData),
        },
        'Apify reel scrape: no view count found in API response (views may be under a different key or not exposed by Instagram)'
      );
    }

    return {
      id: reelData.id || postData.id || instagramData.id || reelData.shortcode || postData.shortcode || reelId,
      shortcode: reelData.shortcode || postData.shortcode || reelId,
      url: reelData.url || postData.url || instagramData.url || reelData.permalink || postData.permalink || reelUrl,
      caption: caption,
      transcript: reelData.transcript || postData.transcript || instagramData.transcript || null,
      likeCount: reelData.likesCount || postData.likesCount || instagramData.likesCount || reelData.likes || postData.likes || instagramData.likes || reelData.likeCount || 0,
      commentCount: reelData.commentsCount || postData.commentsCount || instagramData.commentsCount || reelData.comments || postData.comments || instagramData.comments || reelData.commentCount || 0,
      playCount,
      shareCount: reelData.sharesCount || reelData.shares || null,
      timestamp: reelData.timestamp ? new Date(reelData.timestamp) : (postData.timestamp ? new Date(postData.timestamp) : (instagramData.timestamp ? new Date(instagramData.timestamp) : new Date())),
      videoUrl: reelData.videoUrl || postData.videoUrl || instagramData.videoUrl || reelData.video || postData.video || instagramData.video || null,
      thumbnailUrl: reelData.thumbnailUrl || postData.thumbnailUrl || instagramData.thumbnailUrl || reelData.thumbnail || postData.thumbnail || instagramData.thumbnail || reelData.displayUrl || postData.displayUrl || instagramData.displayUrl || null,
      duration: reelData.duration || postData.duration || instagramData.duration || reelData.videoDuration || postData.videoDuration || instagramData.videoDuration || null,
      hashtags: uniqueHashtags,
      mentions: uniqueMentions,
      taggedUsers: uniqueTaggedUsers,
      comments: comments,
      ownerUsername: reelData.ownerUsername || postData.ownerUsername || instagramData.ownerUsername || reelData.username || postData.username || instagramData.username || postData.author || null,
      ownerFullName: reelData.ownerFullName || postData.ownerFullName || instagramData.ownerFullName || reelData.fullName || postData.fullName || instagramData.fullName || null,
      musicInfo: reelData.musicInfo || postData.musicInfo || instagramData.musicInfo ? {
        artist: (reelData.musicInfo || postData.musicInfo || instagramData.musicInfo)?.artist || null,
        song: (reelData.musicInfo || postData.musicInfo || instagramData.musicInfo)?.song || (reelData.musicInfo || postData.musicInfo || instagramData.musicInfo)?.title || null,
        originalAudio: (reelData.musicInfo || postData.musicInfo || instagramData.musicInfo)?.originalAudio || false,
      } : null,
      isSponsored: reelData.isSponsored !== undefined ? reelData.isSponsored : (postData.isSponsored !== undefined ? postData.isSponsored : (instagramData.isSponsored !== undefined ? instagramData.isSponsored : (apifyData.isAd !== undefined ? apifyData.isAd : false))),
      commentsDisabled: reelData.commentsDisabled !== undefined ? reelData.commentsDisabled : (postData.commentsDisabled !== undefined ? postData.commentsDisabled : (instagramData.commentsDisabled !== undefined ? instagramData.commentsDisabled : false)),
      coAuthors: [
        ...(reelData.coAuthors || reelData.coAuthorProducers || []),
        ...(postData.coAuthors || postData.coauthor || []),
        ...(instagramData.coAuthors || instagramData.coAuthorProducers || []),
      ],
      mediaDimensions: reelData.dimensions || postData.dimensions || instagramData.dimensions ? {
        width: (reelData.dimensions || postData.dimensions || instagramData.dimensions)?.width || null,
        height: (reelData.dimensions || postData.dimensions || instagramData.dimensions)?.height || null,
      } : null,
      // Additional fields from Post Scraper
      postType: postData.postType || postData.type || reelData.mediaType || instagramData.mediaType || null,
      isPinned: postData.isPinned !== undefined ? postData.isPinned : null,
      isPaidPartnership: postData.isPaidPartnership !== undefined ? postData.isPaidPartnership : null,
      childPosts: childPosts.length > 0 ? childPosts : undefined,
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
      imageAltText: imageAltText.length > 0 ? imageAltText : undefined,
      imageDimensions: imageDimensions.length > 0 ? imageDimensions : undefined,
      replyCount: postData.replyCount || null,
      postOwnerInfo: postOwnerInfo,
    };
  }

  /**
   * Try all known Apify/Instagram field names for view/play count
   */
  private extractPlayCount(reelData: any, postData: any, instagramData: any): number | null {
    const viewKeys = [
      'viewsCount', 'viewCount', 'videoViewCount', 'video_view_count', 'videoViews',
      'views', 'playCount', 'play_count', 'videoPlayCount',
    ];
    for (const key of viewKeys) {
      const val = reelData?.[key] ?? postData?.[key] ?? instagramData?.[key];
      if (val != null && typeof val === 'number' && !Number.isNaN(val) && val >= 0) {
        return val;
      }
      if (val != null && typeof val === 'string' && /^\d+$/.test(val)) {
        return parseInt(val, 10);
      }
    }
    return null;
  }

  /**
   * Pick view-related keys from a raw API object for logging (when views are 0)
   */
  private pickViewFields(obj: any): Record<string, unknown> {
    if (!obj || typeof obj !== 'object') return {};
    const viewKeys = [
      'viewsCount', 'viewCount', 'videoViewCount', 'video_view_count', 'videoViews',
      'views', 'playCount', 'play_count', 'videoPlayCount',
    ];
    const out: Record<string, unknown> = {};
    for (const key of viewKeys) {
      if (obj[key] !== undefined) out[key] = obj[key];
    }
    return out;
  }

  /**
   * Extract reel ID from URL
   */
  private extractReelId(url: string): string {
    const match = url.match(/\/reel\/([A-Za-z0-9_-]+)/);
    if (match) {
      return match[1];
    }
    return url.split('/').pop() || 'unknown';
  }

  /**
   * Mock profile data
   */
  private getMockProfile(username: string): ScrapedProfile {
    return {
      username,
      fullName: `${username} Full Name`,
      biography: `Bio for ${username}`,
      followersCount: 15000,
      followingCount: 800,
      postsCount: 200,
      profilePictureUrl: null,
      isVerified: false,
      isPrivate: false,
      externalUrl: null,
    };
  }

  /**
   * Mock reel data
   */
  private getMockReel(reelUrl: string): ScrapedReel {
    const reelId = this.extractReelId(reelUrl);
    return {
      id: reelId,
      shortcode: reelId,
      url: reelUrl,
      caption: 'This is a mock reel caption with some text content.',
      transcript: null,
      likeCount: 2500,
      commentCount: 120,
      playCount: 15000,
      shareCount: 50,
      timestamp: new Date(),
      videoUrl: null,
      thumbnailUrl: null,
      duration: 30,
      hashtags: ['mock', 'test'],
      mentions: [],
      taggedUsers: [],
      comments: [
        {
          id: 'mock-comment-1',
          text: 'Great content!',
          author: 'user1',
          ownerUsername: 'user1',
          timestamp: new Date(),
          likes: 10,
          likesCount: 10,
          replies: [],
        },
        {
          id: 'mock-comment-2',
          text: 'Love this!',
          author: 'user2',
          ownerUsername: 'user2',
          timestamp: new Date(),
          likes: 5,
          likesCount: 5,
          replies: [],
        },
      ],
      ownerUsername: null,
      ownerFullName: null,
      musicInfo: null,
      isSponsored: false,
      commentsDisabled: false,
      coAuthors: [],
      mediaDimensions: null,
      // Additional fields from Post Scraper
      postType: null,
      isPinned: null,
      isPaidPartnership: null,
      childPosts: undefined,
      imageUrls: undefined,
      imageAltText: undefined,
      imageDimensions: undefined,
      replyCount: null,
      postOwnerInfo: null,
    };
  }
}

// Export singleton instance
export const apifyScraper = new ApifyScraperClient();
