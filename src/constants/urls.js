export const LOCAL_API_BASE_URL = `http://localhost:8010${process.env.API_BASE_PATH}`;
export const GIG_DETAILS_API_URL = `${LOCAL_API_BASE_URL}/job`;

export const REFERRAL_API_URL = `${process.env.URL.COMMUNITY_APP}/api`;
export const REFERRAL_PROGRAM_URL = `${process.env.URL.BASE}/community/gig-referral`;

export const CHALLENGE_LIST_URL = `${process.env.URL.BASE}${process.env.CHALLENGE_LIST_PATH}`;
export const GIG_LIST_URL = `${process.env.URL.BASE}${process.env.GIG_LIST_PATH}`;

export const PROFILE_URL = `${process.env.URL.BASE}/settings/profile`;
export const GIGS_FORUM_URL = `${process.env.URL.DISCUSSIONS}/categories/gig-work-discusssions`;

export const LINKEDIN_URL =
  "https://www.linkedin.com/sharing/share-offsite/?url=";
export const FACEBOOK_URL =
  "https://www.facebook.com/sharer/sharer.php?src=share_button&u=";
export const TWITTER_URL = "https://twitter.com/intent/tweet?url=";
