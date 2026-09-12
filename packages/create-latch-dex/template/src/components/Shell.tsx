// SPDX-License-Identifier: MIT
/**
 * The app frame: brand, navigation, wallet button, chain chip, footer.
 *
 * Two rules from the house style are enforced here rather than left to each
 * screen:
 *
 *   * **Static copy must not state anything that can change on chain.** The
 *     header chip shows the live block height and the chain the app is
 *     configured for; it does not claim a pair, a fee or a status that a
 *     screen below might contradict.
 *   * **Navigation follows the feature flags.** A disabled feature is absent
 *     from the nav AND unroutable, so a link can never lead to a screen the
 *     tenant switched off.
 */

import { LatchConnectButton } from "@latchprotocol/connect";
import type { ReactElement, ReactNode } from "react";
import { NavLink } from "react-router-dom";

import { resolveConfig } from "../config/resolve";
import { publicClient } from "../lib/client";
import { useAsync } from "../lib/useAsync";

interface NavItem {
  readonly to: string;
  readonly label: string;
}

function navItems(): NavItem[] {
  const cfg = resolveConfig();
  const items: NavItem[] = [];
  if (cfg.features.swap) items.push({ to: "/swap", label: "Swap" });
  if (cfg.features.pools) items.push({ to: "/pools", label: "Pools" });
  if (cfg.features.launchpad) items.push({ to: "/launch", label: "Launch" });
  items.push({ to: "/fees", label: "Fees" });
  return items;
}

function BlockChip(): ReactElement {
  const cfg = resolveConfig();
  const { state } = useAsync(() => publicClient().getBlockNumber(), []);

  return (
    <span className="chip" title={`Chain ${cfg.core.chainId}`}>
      <span className={`dot ${state.status === "ready" ? "dot-live" : "dot-idle"}`} />
      {cfg.core.name}
      {state.status === "ready" ? (
        <span className="chip-block">#{state.data.toString()}</span>
      ) : state.status === "error" ? (
        <span className="chip-block chip-block-error">unreachable</span>
      ) : (
        <span className="chip-block">…</span>
      )}
    </span>
  );
}

export function Shell({ children }: { children: ReactNode }): ReactElement {
  const cfg = resolveConfig();
  const links = cfg.brand.links ?? {};

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          {cfg.brand.logoUrl === undefined ? null : (
            <img className="brand-logo" src={cfg.brand.logoUrl} alt="" height={28} />
          )}
          <span className="brand-name">{cfg.brand.name}</span>
        </div>

        <nav className="nav" aria-label="Main">
          {navItems().map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? "nav-link nav-link-active" : "nav-link")}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="topbar-right">
          <BlockChip />
          <LatchConnectButton />
        </div>
      </header>

      {!cfg.core.isMainnet ? (
        <div className="banner banner-testnet">
          Testnet. Nothing here is worth anything, and no mainnet deployment is implied.
        </div>
      ) : null}

      <main className="main">{children}</main>

      <footer className="footer">
        <span>
          {cfg.brand.name}
          {cfg.brand.tagline === undefined ? null : (
            <span className="footer-tagline"> · {cfg.brand.tagline}</span>
          )}
        </span>
        <span className="footer-links">
          {links.docs === undefined ? null : <a href={links.docs}>Docs</a>}
          {links.github === undefined ? null : <a href={links.github}>Source</a>}
          {links.x === undefined ? null : <a href={links.x}>X</a>}
          {links.discord === undefined ? null : <a href={links.discord}>Discord</a>}
          {links.terms === undefined ? null : <a href={links.terms}>Terms</a>}
          <a href={cfg.core.explorer} rel="noreferrer">
            Explorer
          </a>
        </span>
      </footer>
    </div>
  );
}
