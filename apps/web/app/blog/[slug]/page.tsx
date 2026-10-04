import type { BlogColor, BlogListItem, BlogPostBlock } from "@/lib/blog";
import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BlogCard } from "@/components/blog/blog-card";
import { BlogComments } from "@/components/blog/comments";
import { SiteShell } from "@/components/blog/site-shell";
import { formatPostDate, getBlogPost, getPublishedBlogPosts } from "@/lib/blog";
import { ArrowLeft, Clock } from "lucide-react";

interface BlogPostPageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return getPublishedBlogPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);

  if (!post) {
    return {
      title: "Blog post not found | Cahootz",
    };
  }

  return {
    title: `${post.title} | Cahootz`,
    description: post.description,
    alternates: {
      canonical: `https://cahootz.coop/blog/${post.slug}`,
    },
    openGraph: {
      type: "article",
      url: `https://cahootz.coop/blog/${post.slug}`,
      title: post.title,
      description: post.description,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt ?? post.publishedAt,
      authors: [post.author],
      tags: post.tags,
      images: [
        {
          url: post.image.startsWith("http")
            ? post.image
            : `https://cahootz.coop${post.image}`,
          alt: post.imageAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [
        post.image.startsWith("http")
          ? post.image
          : `https://cahootz.coop${post.image}`,
      ],
    },
  };
}

const BLOCK_COLOR_STYLES: Partial<Record<BlogColor, CSSProperties>> = {
  gray: { color: "#94a3b8" },
  brown: { color: "#d6a77a" },
  orange: { color: "#fb923c" },
  yellow: { color: "#facc15" },
  green: { color: "#4ade80" },
  blue: { color: "#60a5fa" },
  purple: { color: "#c084fc" },
  pink: { color: "#f472b6" },
  red: { color: "#f87171" },
  gray_background: { backgroundColor: "rgba(148,163,184,.16)" },
  brown_background: { backgroundColor: "rgba(180,120,70,.18)" },
  orange_background: { backgroundColor: "rgba(251,146,60,.16)" },
  yellow_background: { backgroundColor: "rgba(250,204,21,.16)" },
  green_background: { backgroundColor: "rgba(74,222,128,.16)" },
  blue_background: { backgroundColor: "rgba(96,165,250,.16)" },
  purple_background: { backgroundColor: "rgba(192,132,252,.16)" },
  pink_background: { backgroundColor: "rgba(244,114,182,.16)" },
  red_background: { backgroundColor: "rgba(248,113,113,.16)" },
};

function blockColorStyle(color?: BlogColor): CSSProperties | undefined {
  return color ? BLOCK_COLOR_STYLES[color] : undefined;
}

function BlogList({
  block,
}: {
  block: Extract<BlogPostBlock, { type: "list" }>;
}) {
  const List = block.ordered ? "ol" : "ul";
  return (
    <List
      className={`mt-5 space-y-3 pl-7 text-slate-300 marker:font-bold marker:text-[#facc15] ${
        block.ordered ? "list-decimal" : "list-disc"
      }`}
      style={blockColorStyle(block.color)}
    >
      {block.items.map((rawItem, index) => {
        const item: BlogListItem =
          typeof rawItem === "string" ? { text: rawItem } : rawItem;
        return (
          <li
            key={index}
            className="pl-1 leading-8"
            style={blockColorStyle(item.color)}
          >
            <span dangerouslySetInnerHTML={{ __html: item.text }} />
            {item.children?.length ? (
              <div className="-mt-2 ml-1">
                {item.children.map((child, childIndex) => (
                  <BlogBlock
                    key={`${child.type}-${childIndex}`}
                    block={child}
                    nested
                  />
                ))}
              </div>
            ) : null}
          </li>
        );
      })}
    </List>
  );
}

export function BlogBlock({
  block,
  nested = false,
}: {
  block: BlogPostBlock;
  nested?: boolean;
}) {
  if (block.type === "heading") {
    const style = blockColorStyle(block.color);
    if (block.level === 1)
      return (
        <h2
          className="mt-12 text-3xl font-black tracking-tight text-white md:text-4xl"
          style={style}
          dangerouslySetInnerHTML={{ __html: block.text }}
        />
      );
    if (block.level === 3)
      return (
        <h4
          className="mt-8 text-xl font-extrabold tracking-tight text-white md:text-2xl"
          style={style}
          dangerouslySetInnerHTML={{ __html: block.text }}
        />
      );
    return (
      <h3
        className="mt-10 text-2xl font-black tracking-tight text-white md:text-3xl"
        style={style}
        dangerouslySetInnerHTML={{ __html: block.text }}
      />
    );
  }

  if (block.type === "list") {
    return <BlogList block={block} />;
  }

  if (block.type === "quote") {
    return (
      <blockquote
        className="mt-8 border-l-4 border-[#f59e0b] bg-white/[0.04] px-5 py-4 text-xl font-semibold leading-9 text-white"
        style={blockColorStyle(block.color)}
        dangerouslySetInnerHTML={{ __html: block.text }}
      />
    );
  }

  if (block.type === "image") {
    return (
      <figure className="mt-8">
        <div className="overflow-hidden rounded-lg border border-white/10 bg-[#1b1b1b]">
          {/* Body images have unknown intrinsic dimensions, so render at natural aspect ratio. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={block.url}
            alt={block.alt}
            loading="lazy"
            className="h-auto w-full"
          />
        </div>
        {block.caption ? (
          <figcaption className="mt-3 text-center text-sm text-slate-400">
            {block.caption}
          </figcaption>
        ) : null}
      </figure>
    );
  }

  if (block.type === "callout") {
    return (
      <aside
        className="mt-7 rounded-lg border border-white/10 bg-white/[0.05] p-5 text-slate-200"
        style={blockColorStyle(block.color)}
      >
        <div className="flex gap-3">
          {block.icon ? (
            <span className="text-xl" aria-hidden>
              {block.icon}
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <div
              className="leading-8"
              dangerouslySetInnerHTML={{ __html: block.text }}
            />
            {block.children?.map((child, index) => (
              <BlogBlock key={`${child.type}-${index}`} block={child} nested />
            ))}
          </div>
        </div>
      </aside>
    );
  }

  if (block.type === "code") {
    return (
      <figure className="mt-7 overflow-hidden rounded-lg border border-white/10 bg-black/40">
        {block.language ? (
          <div className="border-b border-white/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            {block.language}
          </div>
        ) : null}
        <pre className="overflow-x-auto p-5 text-sm leading-7 text-slate-200">
          <code>{block.text}</code>
        </pre>
        {block.caption ? (
          <figcaption className="border-t border-white/10 px-4 py-2 text-sm text-slate-400">
            {block.caption}
          </figcaption>
        ) : null}
      </figure>
    );
  }

  if (block.type === "divider") {
    return <hr className="my-10 border-white/15" />;
  }

  if (block.type === "todo") {
    return (
      <div
        className="mt-4 flex items-start gap-3 text-slate-300"
        style={blockColorStyle(block.color)}
      >
        <input
          type="checkbox"
          checked={block.checked}
          readOnly
          aria-label={block.checked ? "Completed" : "Not completed"}
          className="mt-2 h-4 w-4 accent-[#facc15]"
        />
        <span
          className={`leading-8 ${block.checked ? "line-through opacity-70" : ""}`}
          dangerouslySetInnerHTML={{ __html: block.text }}
        />
      </div>
    );
  }

  if (block.type === "toggle") {
    return (
      <details
        className="mt-6 rounded-lg border border-white/10 bg-white/[0.03] px-5 py-4"
        style={blockColorStyle(block.color)}
      >
        <summary
          className="cursor-pointer font-bold text-white"
          dangerouslySetInnerHTML={{ __html: block.text }}
        />
        <div className="pb-1 pl-2">
          {block.children.map((child, index) => (
            <BlogBlock key={`${child.type}-${index}`} block={child} nested />
          ))}
        </div>
      </details>
    );
  }

  if (block.type === "table") {
    return (
      <div className="mt-8 overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full min-w-[36rem] border-collapse text-left text-base">
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="border-b border-white/10 last:border-b-0"
              >
                {row.map((cell, cellIndex) => {
                  const isHeader =
                    (block.hasColumnHeader && rowIndex === 0) ||
                    (block.hasRowHeader && cellIndex === 0);
                  const Cell = isHeader ? "th" : "td";
                  return (
                    <Cell
                      key={cellIndex}
                      className={
                        isHeader
                          ? "bg-white/[0.06] px-4 py-3 font-bold text-white"
                          : "px-4 py-3 text-slate-300"
                      }
                      dangerouslySetInnerHTML={{ __html: cell }}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (block.type === "columns") {
    const columnClass =
      block.columns.length >= 4
        ? "md:grid-cols-4"
        : block.columns.length === 3
          ? "md:grid-cols-3"
          : "md:grid-cols-2";
    return (
      <div className={`mt-7 grid gap-6 ${columnClass}`}>
        {block.columns.map((column, columnIndex) => (
          <div key={columnIndex} className="min-w-0">
            {column.map((child, childIndex) => (
              <BlogBlock
                key={`${child.type}-${childIndex}`}
                block={child}
                nested
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (block.type === "equation") {
    return (
      <div className="mt-7 overflow-x-auto rounded-lg bg-white/[0.04] px-5 py-4 text-center font-mono text-white">
        {block.expression}
      </div>
    );
  }

  if (block.type === "bookmark") {
    return (
      <a
        href={block.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-7 block rounded-lg border border-white/10 bg-white/[0.03] p-5 font-semibold text-white transition hover:border-[#f59e0b]/50 hover:bg-white/[0.06]"
      >
        <span className="block break-all">{block.caption || block.url}</span>
        {block.caption ? (
          <span className="mt-2 block break-all text-sm font-normal text-slate-400">
            {block.url}
          </span>
        ) : null}
      </a>
    );
  }

  if (block.type === "media") {
    if (block.mediaType === "audio") {
      return (
        <figure className="mt-7">
          <audio
            controls
            preload="metadata"
            className="w-full"
            src={block.url}
          />
          {block.caption ? (
            <figcaption className="mt-2 text-sm text-slate-400">
              {block.caption}
            </figcaption>
          ) : null}
        </figure>
      );
    }
    if (block.mediaType === "video" && !block.external) {
      return (
        <figure className="mt-7">
          <video
            controls
            preload="metadata"
            className="w-full rounded-lg border border-white/10"
            src={block.url}
          />
          {block.caption ? (
            <figcaption className="mt-2 text-sm text-slate-400">
              {block.caption}
            </figcaption>
          ) : null}
        </figure>
      );
    }
    return (
      <a
        href={block.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-7 block rounded-lg border border-white/10 bg-white/[0.03] p-4 font-semibold text-[#facc15]"
      >
        {block.caption || `Open ${block.mediaType}`}
      </a>
    );
  }

  return (
    <p
      className={`${nested ? "mt-3" : "mt-5"} leading-8 text-slate-300`}
      style={blockColorStyle(block.color)}
      dangerouslySetInnerHTML={{ __html: block.text }}
    />
  );
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = getBlogPost(slug);

  if (!post) {
    notFound();
  }

  const relatedPosts = getPublishedBlogPosts()
    .filter((item) => item.slug !== post.slug)
    .slice(0, 2);

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt ?? post.publishedAt,
    author: {
      "@type": "Organization",
      name: post.author,
    },
    publisher: {
      "@type": "Organization",
      name: "Cahootz",
      logo: {
        "@type": "ImageObject",
        url: "https://cahootz.coop/placeholder-logo.png",
      },
    },
    mainEntityOfPage: `https://cahootz.coop/blog/${post.slug}`,
  };

  return (
    <SiteShell>
      <main>
        <article>
          <section className="border-b border-white/10 px-5 py-12 sm:px-6 md:py-16">
            <div className="mx-auto max-w-4xl">
              <Link
                href="/blog"
                className="inline-flex items-center gap-2 text-sm font-bold text-slate-400 transition hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" />
                Blog
              </Link>

              <div className="mt-8 flex flex-wrap items-center gap-3 text-sm text-slate-400">
                <span className="rounded-md border border-[#f59e0b]/25 bg-[#f59e0b]/10 px-3 py-1 font-bold uppercase tracking-widest text-[#facc15]">
                  {post.category}
                </span>
                <span>{formatPostDate(post.publishedAt)}</span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-4 w-4" />
                  {post.readingTime}
                </span>
              </div>

              <h1 className="mt-6 text-4xl font-black tracking-tight md:text-6xl">
                {post.title}
              </h1>
              <p className="mt-6 text-xl leading-9 text-slate-300">
                {post.excerpt}
              </p>
            </div>
          </section>

          <div className="relative aspect-[16/7] min-h-72 border-b border-white/10 bg-[#1b1b1b]">
            <Image
              src={post.image}
              alt={post.imageAlt}
              fill
              className="object-cover opacity-85"
              sizes="100vw"
              priority
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#111111]/45 to-transparent" />
          </div>

          <section className="px-5 py-12 sm:px-6 md:py-16">
            <div className="mx-auto max-w-3xl text-lg">
              {post.blocks.map((block, index) => (
                <BlogBlock key={`${block.type}-${index}`} block={block} />
              ))}
            </div>
          </section>

          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
          />
        </article>

        <BlogComments
          slug={post.slug}
          url={`https://cahootz.coop/blog/${post.slug}`}
          title={post.title}
        />

        {relatedPosts.length > 0 && (
          <section className="border-t border-white/10 bg-[#161616] px-5 py-16 sm:px-6 md:py-20">
            <div className="mx-auto max-w-7xl">
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
                <div>
                  <p className="text-sm font-bold uppercase tracking-widest text-[#facc15]">
                    Keep reading
                  </p>
                  <h2 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">
                    More from Cahootz.
                  </h2>
                </div>
                <Link
                  href="/blog"
                  className="inline-flex items-center gap-2 text-sm font-bold text-[#facc15] transition hover:text-white"
                >
                  All posts
                </Link>
              </div>

              <div className="mt-10 grid gap-5 md:grid-cols-2">
                {relatedPosts.map((relatedPost) => (
                  <BlogCard key={relatedPost.slug} post={relatedPost} />
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
    </SiteShell>
  );
}
