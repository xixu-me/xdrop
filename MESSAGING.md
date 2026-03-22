# Xdrop Messaging Guide

Use this guide to keep README copy, homepage copy, SEO metadata, Open Graph assets, package
metadata, and social profiles aligned.

## Core Positioning

Canonical one-liner:

`Xdrop is an open source end-to-end encrypted file transfer app for humans and agents, keeping plaintext file names, contents, and keys off the server.`

This is the default introduction for Xdrop when a surface only gets one sentence.

Positioning framework:

- **Category:** Open source end-to-end encrypted file transfer.
- **Primary promise:** Plaintext file names, contents, and keys stay off the server.
- **Supported users:** Humans and agents are both supported users of Xdrop.
- **Common environments:** Includes browser-based sharing for humans and agent workflows in
  remote servers, dev containers, and CI-adjacent environments.

Short positioning summary:

`End-to-end encrypted file transfer for humans and agents.`

## Canonical Copy By Surface

Some surfaces intentionally reuse the canonical one-liner to keep product-facing copy tightly
aligned.

README first sentence, homepage body, and meta description:

`Xdrop is an open source end-to-end encrypted file transfer app for humans and agents, keeping plaintext file names, contents, and keys off the server.`

Homepage H1:

`End-to-end encrypted file transfer.`

Homepage and SEO title:

`Open Source End-to-End Encrypted File Transfer for Humans and Agents | Xdrop`

OG card headline:

`Open source end-to-end encrypted`

`file transfer for humans and agents.`

OG card support line:

`Plaintext file names, contents, and keys stay off the server.`

Short social bio:

`Open source end-to-end encrypted file transfer for humans and agents.`

Short technical summary:

`End-to-end encrypted file transfer with plaintext file names, contents, and keys kept off the server.`

Terminal and agent support blurb:

`Agents can use Xdrop to upload files, return end-to-end encrypted share links, and use Xdrop links for local decryption.`

Use-case summary:

`Humans can use Xdrop in the browser for direct sharing, and agents can use Xdrop in cloud servers, remote containers, and automated terminal workflows.`

Chinese reference copy:

- Canonical one-liner:
  `Xdrop 是一款面向人类与智能体的开源端到端加密文件传输应用，它能确保明文的文件名、文件内容以及密钥都不会留存在服务器上。`
- Short positioning summary:
  `专为人类与智能体打造的端到端加密文件传输。`
- Agent support blurb:
  `智能体可以使用 Xdrop 上传文件，返回端到端加密的分享链接，并使用 Xdrop 链接进行本地解密。`

## Messaging Priorities

When space is limited, keep these ideas in this order:

1. Xdrop is open source.
2. Xdrop is end-to-end encrypted file transfer, not generic file sharing.
3. Plaintext file names, contents, and keys stay off the server.
4. Humans and agents are both supported users of Xdrop.
5. `No account required` is a useful supporting point, but not the main definition.

## Preferred Language

- Prefer `end-to-end encrypted file transfer` as the main category label.
- Prefer `for humans and agents` as the default phrasing when you need a
  product-level line that names both supported users.
- Prefer `agents` or `use Xdrop via an agent` when describing the skill and agent-driven
  experience.
- Prefer `keeps plaintext ... off the server` over `ciphertext-only storage` unless the audience is technical.
- Prefer `open source end-to-end encrypted file transfer app` when introducing Xdrop for the first time.
- Use `AES-256-GCM` in technical docs, threat-model explanations, and implementation notes, not as the default marketing hook.

## Avoid

- Avoid using `private file transfer` as the only product summary.
- Avoid presenting Xdrop as only for humans or only for agents; both are supported users.
- Avoid mixing `private`, `secure`, and `ciphertext-only` as interchangeable main taglines.
- Avoid making `no account required` the primary headline. It is a benefit, not the core definition.
- Avoid shortening the promise to just `secure uploads` because it removes the architecture and
  server-trust model that make Xdrop distinct.
- Avoid making `agents` the only headline unless the surface is explicitly about the skill or
  terminal workflow.

## Tone

- Clear and specific over clever.
- Technical enough to be accurate, but readable for non-specialists.
- Calm and factual instead of hype-heavy.
- Confident about the architecture, careful about broader security claims.
- Product-language first, with workflow details added only where they help explain real use.

## Copy Review Checklist

Before shipping new product-facing copy, check:

- Does it describe Xdrop as open source?
- Does it clearly frame Xdrop as end-to-end encrypted file transfer?
- Does it make clear that plaintext names, contents, and keys stay off the server?
- If it mentions both supported users, does it present humans and agents clearly and evenly?
- If it mentions either humans or agents alone, is that because the surface is
  specifically about that workflow rather than a product-level summary?
- Is `no account required` used as support rather than the core identity?
- Does it avoid introducing a new summary line that conflicts with the canonical one-liner?
