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

/* =========================================================
   SERVER
========================================================= */

Deno.serve(async (request) => {
  try {
    const url = new URL(request.url);

    /*
     * Get all blogs at the same time.
     */
    const blogs = await Promise.all(
      BLOGS.map(getBlog),
    );

    /*
     * =======================================================
     * API ENDPOINT
     *
     * /api
     * =======================================================
     */

    if (url.pathname === "/api") {
      return new Response(
        JSON.stringify(
          {
            success: true,
            blogs,
          },
          null,
          2,
        ),
        {
          headers: {
            "Content-Type":
              "application/json; charset=UTF-8",

            "Access-Control-Allow-Origin":
              "*",

            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    /*
     * =======================================================
     * RAW TEXT ENDPOINT
     *
     * ONLY POST URLS
     * One URL per line.
     * =======================================================
     */

    return new Response(
      formatRawText(blogs),
      {
        headers: {
          "Content-Type":
            "text/plain; charset=UTF-8",

          "Access-Control-Allow-Origin":
            "*",

          "Cache-Control":
            "no-store",
        },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify(
        {
          success: false,

          error:
            error instanceof Error
              ? error.message
              : "Unknown error",
        },
        null,
        2,
      ),
      {
        status: 500,

        headers: {
          "Content-Type":
            "application/json; charset=UTF-8",

          "Access-Control-Allow-Origin":
            "*",

          "Cache-Control":
            "no-store",
        },
      },
    );
  }
});

/* =========================================================
   GET BLOG
========================================================= */

async function getBlog(blog: {
  name: string;
  url: string;
}) {
  try {
    const base =
      blog.url.replace(
        /\/+$/,
        "",
      );

    /*
     * Try several Blogger feed formats.
     *
     * Atom is preferred.
     */
    const feedURLs = [
      base +
        "/feeds/posts/default?alt=atom&max-results=2",

      base +
        "/feeds/posts/default?max-results=2",

      base +
        "/feeds/posts/default?alt=rss&max-results=2",

      base +
        "/feeds/posts/default?alt=atom",

      base +
        "/feeds/posts/default?alt=rss",
    ];

    let xml = "";
    let lastError = "";

    /*
     * =======================================================
     * TRY FEEDS
     * =======================================================
     */

    for (
      const feedURL of feedURLs
    ) {
      try {
        console.log(
          `[${blog.name}] Trying feed: ${feedURL}`,
        );

        const response =
          await fetch(
            feedURL,
            {
              method: "GET",

              redirect:
                "follow",

              headers: {
                "User-Agent":
                  "Mozilla/5.0 (compatible; BlogspotExtractor/2.0)",

                "Accept":
                  "application/atom+xml, application/rss+xml, application/xml, text/xml, */*",
              },
            },
          );

        const text =
          await response.text();

        if (
          response.ok &&
          (
            text.includes(
              "<entry",
            ) ||
            text.includes(
              ":entry",
            ) ||
            text.includes(
              "<item",
            )
          )
        ) {
          xml = text;

          console.log(
            `[${blog.name}] Feed loaded successfully.`,
          );

          break;
        }

        lastError =
          `HTTP ${response.status}`;

        console.log(
          `[${blog.name}] Feed failed: ${lastError}`,
        );
      } catch (error) {
        lastError =
          error instanceof Error
            ? error.message
            : "Request failed";

        console.log(
          `[${blog.name}] Feed request error: ${lastError}`,
        );
      }
    }

    /*
     * =======================================================
     * FEED COULD NOT BE LOADED
     * =======================================================
     */

    if (!xml) {
      return {
        name:
          blog.name,

        page:
          blog.url,

        posts:
          [],

        count:
          0,

        success:
          false,

        error:
          "Could not load Blogger feed" +
          (
            lastError
              ? ` (${lastError})`
              : ""
          ),
      };
    }

    /*
     * =======================================================
     * PARSE FEED
     * =======================================================
     */

    const posts =
      parseFeed(
        xml,
      ).slice(
        0,
        2,
      );

    console.log(
      `[${blog.name}] Found ${posts.length} post(s).`,
    );

    return {
      name:
        blog.name,

      page:
        blog.url,

      posts,

      count:
        posts.length,

      success:
        true,
    };
  } catch (error) {
    return {
      name:
        blog.name,

      page:
        blog.url,

      posts:
        [],

      count:
        0,

      success:
        false,

      error:
        error instanceof Error
          ? error.message
          : "Unknown error",
    };
  }
}

/* =========================================================
   PARSE FEED
========================================================= */

function parseFeed(
  xml: string,
) {
  const posts: {
    url: string;
  }[] = [];

  const seen =
    new Set<string>();

  /*
   * =======================================================
   * ATOM
   *
   * Supports:
   *
   * <entry>
   * <atom:entry>
   * =======================================================
   */

  const entries =
    xml.match(
      /<(?:[A-Za-z0-9_-]+:)?entry\b[\s\S]*?<\/(?:[A-Za-z0-9_-]+:)?entry>/gi,
    ) || [];

  for (
    const entry of entries
  ) {
    let postURL =
      "";

    /*
     * Find every link in the entry.
     */
    const links =
      entry.match(
        /<(?:[A-Za-z0-9_-]+:)?link\b[^>]*>/gi,
      ) || [];

    /*
     * First preference:
     * rel="alternate"
     */
    for (
      const link of links
    ) {
      const rel =
        getAttribute(
          link,
          "rel",
        );

      const href =
        getAttribute(
          link,
          "href",
        );

      if (
        href &&
        rel?.toLowerCase() ===
          "alternate"
      ) {
        postURL =
          decode(
            href,
          );

        break;
      }
    }

    /*
     * Second preference:
     * Any href link.
     */
    if (!postURL) {
      for (
        const link of links
      ) {
        const href =
          getAttribute(
            link,
            "href",
          );

        if (href) {
          postURL =
            decode(
              href,
            );

          break;
        }
      }
    }

    /*
     * Third preference:
     * <link>URL</link>
     */
    if (!postURL) {
      const linkValue =
        getTag(
          entry,
          "link",
        );

      if (linkValue) {
        postURL =
          clean(
            linkValue,
          );
      }
    }

    /*
     * Add post.
     */
    if (
      postURL &&
      isHttpUrl(
        postURL,
      )
    ) {
      const normalized =
        normalizePostUrl(
          postURL,
        );

      if (
        normalized &&
        !seen.has(
          normalized,
        )
      ) {
        seen.add(
          normalized,
        );

        posts.push({
          url:
            normalized,
        });
      }
    }
  }

  /*
   * =======================================================
   * RSS FALLBACK
   * =======================================================
   */

  if (
    posts.length === 0
  ) {
    const items =
      xml.match(
        /<(?:[A-Za-z0-9_-]+:)?item\b[\s\S]*?<\/(?:[A-Za-z0-9_-]+:)?item>/gi,
      ) || [];

    for (
      const item of items
    ) {
      let postURL =
        "";

      /*
       * RSS link can be:
       *
       * <link>https://...</link>
       */

      postURL =
        clean(
          getTag(
            item,
            "link",
          ),
        );

      /*
       * Some feeds may use:
       *
       * <guid>https://...</guid>
       */

      if (
        !postURL
      ) {
        postURL =
          clean(
            getTag(
              item,
              "guid",
            ),
          );
      }

      if (
        postURL &&
        isHttpUrl(
          postURL,
        )
      ) {
        const normalized =
          normalizePostUrl(
            postURL,
          );

        if (
          normalized &&
          !seen.has(
            normalized,
          )
        ) {
          seen.add(
            normalized,
          );

          posts.push({
            url:
              normalized,
          });
        }
      }
    }
  }

  return posts;
}

/* =========================================================
   NORMALIZE POST URL
========================================================= */

function normalizePostUrl(
  value: string,
): string {
  try {
    let cleaned =
      decode(
        clean(
          value,
        ),
      );

    /*
     * Remove whitespace.
     */
    cleaned =
      cleaned.trim();

    /*
     * Remove accidental wrappers.
     */
    cleaned =
      cleaned.replace(
        /^[\s"'`([{<]+/,
        "",
      );

    cleaned =
      cleaned.replace(
        /[\s"'`,.;:!?)}\]>]+$/,
        "",
      );

    const url =
      new URL(
        cleaned,
      );

    /*
     * Only HTTP/HTTPS.
     */
    if (
      url.protocol !==
        "http:" &&
      url.protocol !==
        "https:"
    ) {
      return "";
    }

    /*
     * Remove fragment.
     */
    url.hash = "";

    /*
     * Lowercase hostname.
     */
    url.hostname =
      url.hostname.toLowerCase();

    /*
     * Remove default ports.
     */
    if (
      url.protocol ===
        "https:" &&
      url.port === "443"
    ) {
      url.port = "";
    }

    if (
      url.protocol ===
        "http:" &&
      url.port === "80"
    ) {
      url.port = "";
    }

    /*
     * Remove trailing slash,
     * except root.
     */
    if (
      url.pathname.length > 1 &&
      url.pathname.endsWith("/")
    ) {
      url.pathname =
        url.pathname.slice(
          0,
          -1,
        );
    }

    return url.toString();
  } catch {
    return "";
  }
}

/* =========================================================
   HTTP URL CHECK
========================================================= */

function isHttpUrl(
  value: string,
): boolean {
  try {
    const url =
      new URL(
        value,
      );

    return (
      url.protocol ===
        "http:" ||
      url.protocol ===
        "https:"
    );
  } catch {
    return false;
  }
}

/* =========================================================
   RAW TEXT OUTPUT
=========================================================

ONLY URLs.

Example:

https://ixlskills.blogspot.com/2026/09/post-one.html
https://ixlskills.blogspot.com/2026/09/post-two.html
https://sportlinkzz.blogspot.com/2026/09/post-one.html
https://sportlinkzz.blogspot.com/2026/09/post-two.html
========================================================= */

function formatRawText(
  blogs: {
    name: string;
    page?: string;
    posts: {
      url: string;
    }[];
    error?: string;
  }[],
) {
  const urls:
    string[] = [];

  const seen =
    new Set<string>();

  for (
    const blog of blogs
  ) {
    if (
      !blog.posts ||
      blog.posts.length === 0
    ) {
      continue;
    }

    for (
      const post of blog.posts.slice(
        0,
        2,
      )
    ) {
      if (
        !post.url
      ) {
        continue;
      }

      const normalized =
        normalizePostUrl(
          post.url,
        );

      if (
        !normalized
      ) {
        continue;
      }

      if (
        seen.has(
          normalized,
        )
      ) {
        continue;
      }

      seen.add(
        normalized,
      );

      urls.push(
        normalized,
      );
    }
  }

  return urls.join(
    "\n",
  );
}

/* =========================================================
   XML TAG HELPER
========================================================= */

function getTag(
  xml: string,
  tag: string,
) {
  /*
   * Supports normal and namespaced tags:
   *
   * <link>
   * <atom:link>
   */

  const regex =
    new RegExp(
      "<(?:[A-Za-z0-9_-]+:)?" +
        tag +
        "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?" +
        tag +
        ">",
      "i",
    );

  const match =
    xml.match(
      regex,
    );

  return match
    ? match[1].trim()
    : "";
}

/* =========================================================
   XML ATTRIBUTE HELPER
========================================================= */

function getAttribute(
  tag: string,
  attribute: string,
) {
  const regex =
    new RegExp(
      "(?:^|\\s)" +
        attribute +
        "\\s*=\\s*[\"']([^\"']+)[\"']",
      "i",
    );

  const match =
    tag.match(
      regex,
    );

  return match
    ? match[1]
    : "";
}

/* =========================================================
   CLEAN
========================================================= */

function clean(
  value: string,
) {
  return decode(
    value
      .replace(
        /<!\[CDATA\[/gi,
        "",
      )
      .replace(
        /\]\]>/gi,
        "",
      )
      .replace(
        /<[^>]*>/g,
        "",
      )
      .trim(),
  );
}

/* =========================================================
   DECODE HTML ENTITIES
========================================================= */

function decode(
  value: string,
) {
  return String(
    value,
  )
    .replaceAll(
      "&amp;",
      "&",
    )
    .replaceAll(
      "&lt;",
      "<",
    )
    .replaceAll(
      "&gt;",
      ">",
    )
    .replaceAll(
      "&quot;",
      '"',
    )
    .replaceAll(
      "&#39;",
      "'",
    )
    .replaceAll(
      "&#x27;",
      "'",
    )
    .replaceAll(
      "&#x2F;",
      "/",
    )
    .replaceAll(
      "&#47;",
      "/",
    );
}
