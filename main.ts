const BLOGS = [
  {
    name: "IXL",
    url: "https://ixlskills.blogspot.com/",
  },
  {
    name: "SKTechHH",
    url: "http://sktechhh.blogspot.com/",
  },
  {
    name: "FutureByte55",
    url: "https://futurebyte55.blogspot.com/",
  },
  {
    name: "SportLinkzz",
    url: "https://sportlinkzz.blogspot.com/",
  },
];

const YOUTUBE_CHANNELS = [
  {
    name: "UHTech",
    url: "https://www.youtube.com/@UHTech",
  },
];

/* =========================================================
   SERVER
========================================================= */

Deno.serve(async (request) => {
  try {
    const url = new URL(request.url);

    // Fetch blogs and YouTube videos concurrently.
    const [blogs, youtube] = await Promise.all([
      Promise.all(BLOGS.map(getBlog)),
      Promise.all(
        YOUTUBE_CHANNELS.map(getYouTubeChannel),
      ),
    ]);

    /*
     * =======================================================
     * JSON API
     *
     * GET /api
     * =======================================================
     */

    if (url.pathname === "/api") {
      return jsonResponse({
        success: true,
        blogs,
        youtube,
      });
    }

    /*
     * =======================================================
     * RAW TEXT
     *
     * GET /
     *
     * Blog URLs first, then YouTube video URLs.
     * One URL per line.
     * =======================================================
     */

    const blogText = formatRawText(blogs);

    const videoURLs = youtube.flatMap((channel) =>
      channel.videos.map((video) => video.url)
    );

    const allURLs = [
      ...blogText.split("\n").filter(Boolean),
      ...videoURLs,
    ];

    return new Response(
      [...new Set(allURLs)].join("\n"),
      {
        headers: {
          "Content-Type": "text/plain; charset=UTF-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: error instanceof Error
          ? error.message
          : "Unknown error",
      },
      500,
    );
  }
});

/* =========================================================
   JSON RESPONSE
========================================================= */

function jsonResponse(
  data: unknown,
  status = 200,
) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      },
    },
  );
}

/* =========================================================
   GET BLOG
========================================================= */

async function getBlog(blog: {
  name: string;
  url: string;
}) {
  try {
    const base = blog.url.replace(/\/+$/, "");

    const feedURLs = [
      `${base}/feeds/posts/default?alt=atom&max-results=2`,
      `${base}/feeds/posts/default?max-results=2`,
      `${base}/feeds/posts/default?alt=rss&max-results=2`,
      `${base}/feeds/posts/default?alt=atom`,
      `${base}/feeds/posts/default?alt=rss`,
    ];

    let xml = "";
    let lastError = "";

    for (const feedURL of feedURLs) {
      try {
        console.log(
          `[${blog.name}] Trying feed: ${feedURL}`,
        );

        const response = await fetch(feedURL, {
          method: "GET",
          redirect: "follow",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; BlogspotExtractor/3.0)",
            "Accept":
              "application/atom+xml, application/rss+xml, application/xml, text/xml, */*",
          },
          signal: AbortSignal.timeout(10000),
        });

        const text = await response.text();

        if (
          response.ok &&
          (
            /<(?:[\w-]+:)?entry\b/i.test(text) ||
            /<(?:[\w-]+:)?item\b/i.test(text)
          )
        ) {
          xml = text;
          console.log(`[${blog.name}] Feed loaded.`);
          break;
        }

        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error
          ? error.message
          : "Request failed";
      }
    }

    if (!xml) {
      return {
        name: blog.name,
        page: blog.url,
        posts: [],
        count: 0,
        success: false,
        error: `Could not load Blogger feed${
          lastError ? ` (${lastError})` : ""
        }`,
      };
    }

    const posts = parseFeed(xml).slice(0, 2);

    return {
      name: blog.name,
      page: blog.url,
      posts,
      count: posts.length,
      success: true,
    };
  } catch (error) {
    return {
      name: blog.name,
      page: blog.url,
      posts: [],
      count: 0,
      success: false,
      error: error instanceof Error
        ? error.message
        : "Unknown error",
    };
  }
}

/* =========================================================
   GET YOUTUBE CHANNEL
========================================================= */

async function getYouTubeChannel(channel: {
  name: string;
  url: string;
}) {
  try {
    /*
     * Resolve the channel ID from the public channel page.
     *
     * The handle itself is not the channel ID.
     */

    const response = await fetch(channel.url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(
        `Could not load channel page: HTTP ${response.status}`,
      );
    }

    const html = await response.text();

    /*
     * YouTube commonly embeds the channel ID as
     * channelId or externalId.
     */

    const channelIDMatch =
      html.match(
        /"(?:channelId|externalId)"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/,
      ) ||
      html.match(
        /youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/,
      );

    if (!channelIDMatch) {
      throw new Error(
        "Could not find the YouTube channel ID. Check the handle or use the channel's /channel/UC... URL.",
      );
    }

    const channelID = channelIDMatch[1];

    /*
     * Fetch YouTube's public Atom feed.
     *
     * The feed usually contains the latest uploads.
     */

    const feedURL =
      `https://www.youtube.com/feeds/videos.xml?channel_id=${channelID}`;

    const feedResponse = await fetch(feedURL, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept":
          "application/atom+xml, application/xml, text/xml",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!feedResponse.ok) {
      throw new Error(
        `Could not load YouTube feed: HTTP ${feedResponse.status}`,
      );
    }

    const xml = await feedResponse.text();

    if (!/<(?:[\w-]+:)?entry\b/i.test(xml)) {
      throw new Error(
        "YouTube feed returned no video entries.",
      );
    }

    const videos = parseYouTubeFeed(xml).slice(0, 2);

    return {
      name: channel.name,
      channel: channel.url,
      channelID,
      videos,
      count: videos.length,
      success: true,
    };
  } catch (error) {
    console.error(
      `[${channel.name}] YouTube error:`,
      error,
    );

    return {
      name: channel.name,
      channel: channel.url,
      videos: [],
      count: 0,
      success: false,
      error: error instanceof Error
        ? error.message
        : "Unknown error",
    };
  }
}

/* =========================================================
   PARSE YOUTUBE ATOM FEED
========================================================= */

function parseYouTubeFeed(xml: string) {
  const entries =
    xml.match(
      /<(?:[\w-]+:)?entry\b[\s\S]*?<\/(?:[\w-]+:)?entry>/gi,
    ) || [];

  const videos: {
    title: string;
    videoId: string;
    url: string;
    published: string;
  }[] = [];

  const seen = new Set<string>();

  for (const entry of entries) {
    const videoId = clean(
      getTag(entry, "videoId"),
    );

    const title = clean(
      getTag(entry, "title"),
    );

    const published = clean(
      getTag(entry, "published"),
    );

    if (!videoId || seen.has(videoId)) {
      continue;
    }

    /*
     * YouTube video IDs are normally 11 characters.
     * Validate before constructing the watch URL.
     */

    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      continue;
    }

    seen.add(videoId);

    videos.push({
      title,
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      published,
    });
  }

  return videos;
}

/* =========================================================
   PARSE BLOGGER FEED
========================================================= */

function parseFeed(xml: string) {
  const posts: { url: string }[] = [];
  const seen = new Set<string>();

  /*
   * ATOM FEEDS
   */

  const entries =
    xml.match(
      /<(?:[\w-]+:)?entry\b[\s\S]*?<\/(?:[\w-]+:)?entry>/gi,
    ) || [];

  for (const entry of entries) {
    let postURL = "";

    const links =
      entry.match(
        /<(?:[\w-]+:)?link\b[^>]*>/gi,
      ) || [];

    // First preference: rel="alternate".
    for (const link of links) {
      const rel = getAttribute(link, "rel");
      const href = getAttribute(link, "href");

      if (
        href &&
        rel?.toLowerCase() === "alternate"
      ) {
        postURL = decode(href);
        break;
      }
    }

    // Second preference: any href.
    if (!postURL) {
      for (const link of links) {
        const href = getAttribute(link, "href");

        if (href) {
          postURL = decode(href);
          break;
        }
      }
    }

    // Third preference: text inside a link element.
    if (!postURL) {
      postURL = clean(getTag(entry, "link"));
    }

    if (!postURL || !isHttpUrl(postURL)) {
      continue;
    }

    const normalized = normalizePostUrl(postURL);

    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      posts.push({ url: normalized });
    }
  }

  /*
   * RSS FALLBACK
   */

  if (posts.length === 0) {
    const items =
      xml.match(
        /<(?:[\w-]+:)?item\b[\s\S]*?<\/(?:[\w-]+:)?item>/gi,
      ) || [];

    for (const item of items) {
      let postURL = clean(getTag(item, "link"));

      if (!postURL) {
        postURL = clean(getTag(item, "guid"));
      }

      if (!postURL || !isHttpUrl(postURL)) {
        continue;
      }

      const normalized = normalizePostUrl(postURL);

      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        posts.push({ url: normalized });
      }
    }
  }

  return posts;
}

/* =========================================================
   FORMAT RAW BLOG URLS
========================================================= */

function formatRawText(
  blogs: {
    name: string;
    page?: string;
    posts: { url: string }[];
  }[],
) {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const blog of blogs) {
    for (const post of (blog.posts || []).slice(0, 2)) {
      if (!post.url) {
        continue;
      }

      const normalized = normalizePostUrl(post.url);

      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      urls.push(normalized);
    }
  }

  return urls.join("\n");
}

/* =========================================================
   NORMALIZE POST URL
========================================================= */

function normalizePostUrl(value: string): string {
  try {
    let cleaned = decode(clean(value)).trim();

    cleaned = cleaned.replace(
      /^[\s"'`([{<]+/,
      "",
    );

    cleaned = cleaned.replace(
      /[\s"'`,.;:!?)}\]>]+$/,
      "",
    );

    const url = new URL(cleaned);

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return "";
    }

    url.hash = "";
    url.hostname = url.hostname.toLowerCase();

    if (
      (url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")
    ) {
      url.port = "";
    }

    if (
      url.pathname.length > 1 &&
      url.pathname.endsWith("/")
    ) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    return "";
  }
}

/* =========================================================
   HTTP URL CHECK
========================================================= */

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );
  } catch {
    return false;
  }
}

/* =========================================================
   XML TAG HELPER
   Supports normal and namespaced tags.
========================================================= */

function getTag(xml: string, tag: string) {
  const escapedTag = tag.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );

  const regex = new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${escapedTag}\\s*>`,
    "i",
  );

  const match = xml.match(regex);

  return match ? match[1].trim() : "";
}

/* =========================================================
   XML ATTRIBUTE HELPER
========================================================= */

function getAttribute(
  tag: string,
  attribute: string,
) {
  const escapedAttribute = attribute.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );

  const regex = new RegExp(
    `(?:^|\\s)${escapedAttribute}\\s*=\\s*["']([^"']*)["']`,
    "i",
  );

  const match = tag.match(regex);

  return match ? match[1] : "";
}

/* =========================================================
   CLEAN XML TEXT
========================================================= */

function clean(value: string) {
  return decode(
    value
      .replace(/<!\[CDATA\[/gi, "")
      .replace(/\]\]>/gi, "")
      .replace(/<[^>]*>/g, "")
      .trim(),
  );
}

/* =========================================================
   DECODE HTML/XML ENTITIES
========================================================= */

function decode(value: string) {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/")
    .replace(/&#(\d+);/g, (_match, number) =>
      decodeNumericEntity(Number(number))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, number) =>
      decodeNumericEntity(parseInt(number, 16))
    );
}

function decodeNumericEntity(code: number) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}
