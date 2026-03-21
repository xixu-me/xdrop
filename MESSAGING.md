# Xdrop Messaging Guide

Use this guide to keep README copy, homepage copy, SEO metadata, Open Graph assets, package
metadata, and social profiles aligned.

## Core Positioning

Canonical one-liner:

`Xdrop is an open source encrypted file transfer app for browsers and agent-driven terminal workflows, keeping plaintext file names, contents, and keys off the server.`

This is the default introduction for Xdrop when a surface only gets one sentence.

Positioning framework:

- **Category:** Open source encrypted file transfer.
- **Primary promise:** Plaintext file names, contents, and keys stay off the server.
- **Default experience:** Browser-first for normal sharing flows.
- **Extended workflow:** Also usable from agent-driven terminal environments such as Codex, remote
  servers, dev containers, and CI-adjacent workflows.

Short positioning summary:

`Browser-first encrypted file transfer, with agent-ready terminal workflows.`

## Canonical Copy By Surface

README first sentence:

`Xdrop is an open source encrypted file transfer app for browsers and agent-driven terminal workflows, keeping plaintext file names, contents, and keys off the server.`

Homepage H1:

`Encrypted file transfer.`

Homepage body:

`Xdrop is an open source encrypted file transfer app for browsers and agent-driven terminal workflows, keeping plaintext file names, contents, and keys off the server.`

Homepage and SEO title:

`Open Source Encrypted File Transfer for Browsers and Agents | Xdrop`

Meta description:

`Xdrop is an open source encrypted file transfer app for browsers and agent-driven terminal workflows, keeping plaintext file names, contents, and keys off the server.`

OG card headline:

`Open source encrypted`

`file transfer for browsers and agents.`

OG card support line:

`Plaintext file names, contents, and keys stay off the server.`

Short social bio:

`Open source encrypted file transfer for browsers and agents. Plaintext file names, contents, and keys stay off the server.`

Short technical summary:

`Browser-first encrypted file transfer with agent-ready terminal workflows and plaintext kept off the server.`

Terminal and agent support blurb:

`Xdrop can also be used from agent-driven terminal workflows to upload files, return encrypted share links, and download full Xdrop links for local decryption.`

Use-case summary:

`Use Xdrop in the browser for normal sharing, or through an agent when you need to move files out of a cloud server, remote container, or automated terminal workflow.`

Chinese reference copy:

- Canonical one-liner:
  `Xdrop 是一个开源加密文件传输应用，以浏览器为主体验，也支持智能体驱动的终端工作流，并确保服务端拿不到明文文件名、文件内容和密钥。`
- Short positioning summary:
  `以浏览器为主体验的加密文件传输，也支持智能体终端工作流。`
- Agent support blurb:
  `日常分享可直接使用浏览器；如果你需要将文件从云服务器、远程容器或自动化终端流程中传出来，也可以通过智能体使用 Xdrop。`

## Messaging Priorities

When space is limited, keep these ideas in this order:

1. Xdrop is open source.
2. Xdrop is encrypted file transfer, not generic file sharing.
3. Plaintext file names, contents, and keys stay off the server.
4. The product is browser-first, but not browser-only.
5. `No account required` is a useful supporting point, but not the main definition.

## Preferred Language

- Prefer `encrypted file transfer` as the main category label.
- Prefer `browser-first` when you need to signal the main UX without implying the browser is the
  only supported way to use Xdrop.
- Prefer `agent-driven terminal workflows` or `use Xdrop via an agent` when describing the skill
  and CLI-style experience.
- Prefer `encrypts files in your browser` when the copy is specifically about the web app flow.
- Prefer `keeps plaintext ... off the server` over `ciphertext-only storage` unless the audience is technical.
- Prefer `open source encrypted file transfer app` when introducing Xdrop for the first time.
- Prefer `in-browser encryption` as a compact technical benefit, not as the whole product category.
- Use `AES-256-GCM` in technical docs, threat-model explanations, and implementation notes, not as the default marketing hook.

## Avoid

- Avoid using `private file transfer` as the only product summary.
- Avoid presenting Xdrop as browser-only now that agent workflows are a supported entry point.
- Avoid mixing `private`, `secure`, `browser-side`, and `ciphertext-only` as interchangeable main taglines.
- Avoid making `no account required` the primary headline. It is a benefit, not the core definition.
- Avoid shortening the promise to just `secure uploads` because it removes the architecture and
  server-trust model that make Xdrop distinct.
- Avoid making `agents` or `CLI` the only headline unless the surface is explicitly about the skill
  or terminal workflow.

## Tone

- Clear and specific over clever.
- Technical enough to be accurate, but readable for non-specialists.
- Calm and factual instead of hype-heavy.
- Confident about the architecture, careful about broader security claims.
- Product-language first, with workflow details added only where they help explain real use.

## Copy Review Checklist

Before shipping new product-facing copy, check:

- Does it describe Xdrop as open source?
- Does it clearly frame Xdrop as encrypted file transfer?
- Does it make clear that plaintext names, contents, and keys stay off the server?
- If it mentions the main UX, does it say browser-first rather than implying browser-only?
- If it mentions agent usage, does it describe it as an additional workflow rather than a separate
  product?
- Is `no account required` used as support rather than the core identity?
- Does it avoid introducing a new summary line that conflicts with the canonical one-liner?
