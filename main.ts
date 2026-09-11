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
];

Deno.serve(async (request) => {
  const url = new URL(request.url);

  const blogs = await Promise.all(
    BLOGS.map(getBlog),
  );

  /*
   * API endpoint
   *
   * Example:
   * /api
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
          "Content-Type": "application/json; charset=UTF-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  /*
   * Main page
   *
   * ONLY post URLs.
   * One URL per line.
   */
  return new Response(
    formatRawText(blogs),
    {
      headers: {
        "Content-Type": "text/plain; charset=UTF-8",
        "Cache-Control": "no-store",
      },
    },
  );
});


/*
 * =========================
 * GET BLOG
 * =========================
 */

async function getBlog(blog: {
  name: string;
  url: string;
}) {
  try {
    const base = blog.url.replace(/\/+$/, "");

    const feedURLs = [
      base + "/feeds/posts/default?alt=atom&max-results=2",
      base + "/feeds/posts/default?alt=rss&max-results=2",
      base + "/feeds/posts/default?max-results=2",
    ];

    let xml = "";
    let lastError = "";

    /*
     * Try each Blogger feed format.
     */
    for (const feedURL of feedURLs) {
      try {
        const response = await fetch(feedURL, {
          method: "GET",
          redirect: "follow",

          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; BlogspotExtractor/1.0)",
          },
        });

        if (response.ok) {
          const text = await response.text();

          if (
            text.includes("<entry") ||
            text.includes("<item")
          ) {
            xml = text;
            break;
          }
        }

        lastError = "HTTP " + response.status;
      } catch (e) {
        lastError =
          e instanceof Error
            ? e.message
            : "Request failed";
      }
    }

    /*
     * Feed could not be loaded.
     */
    if (!xml) {
      return {
        name: blog.name,
        posts: [],
        error:
          "Could not load Blogger feed" +
          (lastError ? " (" + lastError + ")" : ""),
      };
    }

    /*
     * Only keep the first 2 posts.
     */
    const posts = parseFeed(xml).slice(0, 2);

    return {
      name: blog.name,
      posts,
    };
  } catch (error) {
    return {
      name: blog.name,
      posts: [],
      error:
        error instanceof Error
          ? error.message
          : "Unknown error",
    };
  }
}


/*
 * =========================
 * PARSE FEED
 * =========================
 */

function parseFeed(xml: string) {
  const posts: { url: string }[] = [];

  /*
   * Blogger Atom
   */
  const entries =
    xml.match(
      /<entry[\s\S]*?<\/entry>/gi,
    ) || [];

  for (const entry of entries) {
    let postURL = "";

    const links =
      entry.match(
        /<link\b[^>]*>/gi,
      ) || [];

    /*
     * Find the actual post URL.
     */
    for (const link of links) {
      const rel = getAttribute(
        link,
        "rel",
      );

      const href = getAttribute(
        link,
        "href",
      );

      if (
        href &&
        (
          rel === "alternate" ||
          !rel
        )
      ) {
        postURL = decode(href);

        if (rel === "alternate") {
          break;
        }
      }
    }

    if (postURL) {
      posts.push({
        url: postURL,
      });
    }
  }


  /*
   * RSS fallback
   */
  if (posts.length === 0) {
    const items =
      xml.match(
        /<item[\s\S]*?<\/item>/gi,
      ) || [];

    for (const item of items) {
      const postURL = clean(
        getTag(
          item,
          "link",
        ),
      );

      if (postURL) {
        posts.push({
          url: postURL,
        });
      }
    }
  }

  return posts;
}


/*
 * =========================
 * RAW TEXT OUTPUT
 * =========================
 *
 * ONLY URLs.
 *
 * Example:
 *
 * https://example.blogspot.com/2026/09/post-one.html
 * https://example.blogspot.com/2026/09/post-two.html
 *
 */

function formatRawText(
  blogs: {
    name: string;
    posts: { url: string }[];
    error?: string;
  }[],
) {
  const urls: string[] = [];

  for (const blog of blogs) {
    if (
      blog.posts &&
      blog.posts.length > 0
    ) {
      for (
        const post of blog.posts.slice(0, 2)
      ) {
        if (post.url) {
          urls.push(post.url);
        }
      }
    }
  }

  return urls.join("\n");
}


/*
 * =========================
 * XML HELPERS
 * =========================
 */

function getTag(
  xml: string,
  tag: string,
) {
  const regex = new RegExp(
    "<" +
      tag +
      "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" +
      tag +
      ">",
    "i",
  );

  const match = xml.match(regex);

  return match
    ? match[1].trim()
    : "";
}


function getAttribute(
  tag: string,
  attribute: string,
) {
  const regex = new RegExp(
    attribute +
      "\\s*=\\s*[\"']([^\"']+)[\"']",
    "i",
  );

  const match = tag.match(regex);

  return match
    ? match[1]
    : "";
}


/*
 * =========================
 * CLEAN / DECODE
 * =========================
 */

function clean(value: string) {
  return decode(
    value
      .replace(
        /<!\[CDATA\[/g,
        "",
      )
      .replace(
        /\]\]>/g,
        "",
      )
      .replace(
        /<[^>]*>/g,
        "",
      )
      .trim(),
  );
}


function decode(value: string) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/");
}
