# TerraPulse MongoDB Atlas connectivity diagnostic

Date: 13 November 2026. Final health verification: 22:46:47 Africa/Cairo (20:46:47 UTC).

Scope: read-only inspection and bounded connectivity probes using the existing configuration. This report is the only file created by the diagnostic. No application restart, source/configuration change, dependency installation, seed, ingestion, collection operation, or database write was performed.

## Finding and recommended recovery

**Connectivity is currently healthy. The reported TLS failure did not reproduce, and its historical root cause cannot be established from the available evidence.**

- All three SRV targets resolved and accepted TCP connections on port 27017.
- All three targets completed certificate-validated TLS 1.3 handshakes with hostname verification and SNI.
- The installed MongoDB driver connected and successfully executed a read-only `ping` using the existing URI.
- Mongoose connected using the application's connection options and successfully executed a read-only `ping`.
- The already running application returned HTTP 200 from both `/health/live` and `/health/ready`; readiness reported a configured, connected database. A later health check also returned 200 for both endpoints.

**Smallest safe action: preserve the current configuration and running process. No code, URI, certificate, TLS, timeout, or package change is justified by these observations.** No corrective change was applied. Recovery was observed during the investigation; it is not attributed to the diagnostic probes or to any particular Atlas/network action.

These are point-in-time results. They do not establish that the earlier failure was harmless, identify what changed, or guarantee that an intermittent problem will not recur.

## Runtime and installed dependencies

| Component | Observed value |
| --- | --- |
| Diagnostic Node.js executable | v22.17.1 |
| OpenSSL bundled with that Node.js executable | 3.0.16 |
| Platform / architecture | Windows / x64 |
| Mongoose | 9.12.1 |
| MongoDB Node.js driver actually resolved by Mongoose | 7.8.0 |
| dotenv | 18.0.10 |
| Project Node.js engine requirement | >=22.17.1 |
| Installed Mongoose Node.js engine requirement | >=20.19.0 |
| Installed MongoDB driver Node.js engine requirement | >=20.19.0 |

Installed versions agree with `package-lock.json`. Mongoose declares MongoDB driver `~7.8`, and resolves the same 7.8.0 package as the direct diagnostic. The runtime meets the local package requirements. MongoDB's official compatibility table lists Node.js 22 with driver 7.0–7.8. There is no evidence of a Node.js/driver compatibility failure. See [MongoDB compatibility tables](https://www.mongodb.com/docs/drivers/compatibility/?driver-language=javascript&javascript-driver-framework=nodejs).

No standalone `openssl` executable was available on PATH. TLS checks used Node's own `node:tls` and bundled OpenSSL, which directly tests the relevant runtime. The live listener's executable could not be identified through the attempted Windows CIM inspection; the version above describes the diagnostic executable, not a separately verified runtime inside the existing server process. Other Node.js processes were present and were left untouched. The Atlas server version was not queried, so server-version compatibility was not independently audited.

## Existing application configuration

Files inspected: `src/config/env.js`, `src/config/database.js`, `src/server.js`, `src/modules/health/health.routes.js`, `package.json`, `package-lock.json`, and installed package metadata/driver connection code. The study-area integration check was inspected, but no integration suite was executed.

### Environment loading

- The actual connection variable is **`MONGODB_URI`**.
- `loadEnv()` reads the repository-root `.env` via a module-relative absolute path, with dotenv logging suppressed. It then parses `process.env`.
- Existing process variables take precedence because dotenv's override option is not enabled.
- In this diagnostic shell, `MONGODB_URI` was absent before loading; `.env` supplied it. The resulting trimmed URI matched the parsed `.env` value. Neither value was displayed or copied into this report.
- The effective scheme is `mongodb+srv`; the seed is in the Atlas hostname domain. Hostnames, addresses, database names, credentials, and private environment values are intentionally omitted.
- Recognized URI option names present: `retryWrites`, `w`, `appName`. Their values are omitted. DNS TXT supplies recognized `authSource` and `replicaSet` options; values are omitted.
- No disabled certificate verification or insecure TLS setting was detected in the effective configuration. The application does not supply custom TLS options.
- The live server's inherited environment was not read; it may differ from the diagnostic shell's environment. Its readiness nevertheless succeeded.

### Mongoose connection, retries, and events

`createDatabase()` creates an independent Mongoose connection and calls `openUri()` with:

| Option | Value |
| --- | --- |
| serverSelectionTimeoutMS | 5000 |
| connectTimeoutMS | 5000 |
| heartbeatFrequencyMS | 5000 |
| maxPoolSize | 10 |
| bufferCommands | false |
| autoIndex | false |
| autoCreate | false |

Initial connection failures are caught, followed by a 5000 ms retry timer. Established connections use Mongoose/driver reconnection behavior. The timer is unreferenced; shutdown clears it and waits for any pending bounded connection attempt before closing. `start()` is guarded against duplicate starts.

The module registers `connected`, `disconnected`, and `error` handlers. The `error` handler deliberately logs only a generic message; the initial connection catch discards the error object. This protects credentials but prevents historical TLS cause analysis from those messages alone.

The Express listener starts independently of database connectivity. `/health/live` reports process liveness. `/health/ready` returns 503 unless the database connection is ready. This explains the reported combination of liveness 200 and readiness/database endpoints 503 during a database outage; it is not evidence of an Express startup defect. A missing URI can also produce that split, but it was present and working in the current checks.

The five-second selection timeout is not an established cause of the earlier TLS alert. Both diagnostic connections succeeded within that selection interval. Increasing timeouts would not, by itself, explain or repair a peer-generated TLS internal error.

## DNS, TCP, and TLS results

Targets are assigned anonymous labels; no private hostname, address, or raw DNS TXT value is retained here.

| Check | Result |
| --- | --- |
| `_mongodb._tcp.<seed>` SRV lookup | Success; three targets, all port 27017 |
| Seed TXT lookup | Success; one record; recognized keys `authSource`, `replicaSet` |
| Seed direct address lookup | `ENOTFOUND`; see interpretation below |
| Address lookup of each SRV target | Success; one IPv4 address per target |

| Anonymous target | TCP 27017 | TCP elapsed | Validated TLS | TLS elapsed | Peer issuer organization |
| --- | --- | --- | --- | --- | --- |
| atlas-host-1 | Success | 369 ms | TLSv1.3; authorized | 691 ms | Let's Encrypt |
| atlas-host-2 | Success | 368 ms | TLSv1.3; authorized | 2219 ms | Let's Encrypt |
| atlas-host-3 | Success | 308 ms | TLSv1.3; authorized | 746 ms | Let's Encrypt |

The observed certificate expiry was 10 February 2027 at 00:42:37 GMT on each target. TLS sockets used the actual target as SNI server name, default Node trust, and `rejectUnauthorized: true`. No TLS version, cipher, or security level was weakened. Timing is elapsed probe time, not a latency benchmark.

The SRV seed's direct A/AAAA lookup failure is **not a demonstrated fault**: SRV connections discover individual hosts through SRV records instead of requiring a direct address for the seed. Successful target resolution, TLS, driver connection, and ping confirm that discovery worked in these checks. Replacing the URI or changing DNS is unwarranted.

MongoDB documents SRV/TXT troubleshooting and port 27017 requirements in its [Atlas connection troubleshooting guide](https://www.mongodb.com/docs/atlas/troubleshoot-connection/).

## Minimal read-only connection results

Both probes used `loadEnv()` and the unchanged effective URI. Each client was closed in a `finally` block. No models were registered, no collections/indexes were created, and no business records were queried or modified.

| Probe | Options | Result |
| --- | --- | --- |
| MongoClient from Mongoose's resolved driver | Same selection/connect/heartbeat/pool limits as the app | Connected in 2843 ms; `ping` returned `ok: 1` |
| Isolated Mongoose connection | Exact `openUri()` options listed above, including `autoCreate: false` and `autoIndex: false` | Connected in 2692 ms; `ping` returned `ok: 1` |
| Existing running app `/health/live` | GET only | 200 |
| Existing running app `/health/ready` | GET only | 200; configured / ready / connected |
| Later existing-app health verification | GET only | Both endpoints 200 |

The MongoClient probe registered a heartbeat-failure listener; none was emitted during the bounded check. Connection and ping completed without a reported authentication error. This does not audit application collection permissions: `ping` and readiness do not establish authorization to read every collection or perform other operations.

The user's reported 136 passing regression tests and three failing integration suites describe the earlier state. Those suites were not rerun during this diagnostic. Current evidence is specifically the network checks, isolated connections/pings, and existing-process health responses above.

## Sanitized errors and historical evidence limits

### Reported original failure

```text
Source: user-provided incident description
code: ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR
full message / stack / nested cause: unavailable
historical server-selection topology and per-host errors: unavailable
historical failure timestamp: not supplied
```

No such TLS error was emitted by the new probes. It would be inaccurate to invent an underlying `MongoNetworkError`, stack trace, certificate error, alert text, or per-host failure from the error code alone. The OpenSSL error label by itself does not establish which TLS version was negotiated or which system caused the peer's internal error.

### Only connection-related error observed during these checks

```text
Operation: direct address lookup of the SRV seed
name: Error
code: ENOTFOUND
message: getaddrinfo ENOTFOUND [ATLAS SEED REDACTED]
Impact: none observed; SRV target discovery and authenticated client connections succeeded
```

No repository `.log` files were found outside dependencies. Existing reports were checked for connection/TLS evidence; they did not contain the original TLS stack or nested cause. Some readiness references concern dataset lifecycle and are not database connection failures. The running server's historical terminal output was not available as a file and was not attached to, restarted, or otherwise disturbed. Generic source-defined log messages include:

```text
MongoDB connection error. Check configuration and network access.
MongoDB unavailable. Retrying initial connection in 5000 ms.
```

These messages are from inspected source, not newly observed failures.

## Proxy, security software, and network-path assessment

- `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and `NO_PROXY` are present in the diagnostic shell. Only presence was inspected/reported; endpoints, credentials, and values remain private. This does not establish the running server's environment.
- `NODE_EXTRA_CA_CERTS`, `NODE_OPTIONS`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, and `NODE_TLS_REJECT_UNAUTHORIZED` were absent in this diagnostic shell.
- Windows user Internet Settings showed proxy disabled, no configured proxy server, and no auto-configuration URL. This does not exclude transparent network appliances, VPN routing, or machine-level controls.
- The inspected MongoDB driver opens native sockets and supports an explicit `proxyHost` path. No explicit proxy option is configured by the inspected application. HTTP proxy environment variables alone do not establish MongoDB socket interception.
- The Windows Defender service was running. Antivirus product enumeration failed with `CimException`; therefore a complete antivirus inventory and TLS-inspection settings could not be verified. No protection was disabled or reconfigured.
- All direct TLS probes validated public certificates issued by Let's Encrypt. There is no evidence of a certificate-substituting interceptor on those tested connections. This does not exclude a transient reset/filter, a different earlier path, or interception affecting another process.

## Remaining hypotheses

No historical hypothesis is confirmed or ranked as the exact cause.

| Hypothesis | Current evidence | Evidence needed if the incident recurs |
| --- | --- | --- |
| Temporary Atlas edge/backend or cluster event | All hosts and client connections work now; historical Atlas state unavailable | Failure timestamps correlated with cluster events, logs, and provider support |
| Historical egress IP / IP access-list mismatch or propagation | Current clients can connect; no Atlas access-list inspection was available | Application's actual egress IP at failure versus active project entries and audit history |
| Temporary firewall, VPN, antivirus, or network filtering | Current TCP/TLS works; full security inventory unavailable | Same-time network/security logs and comparison of an approved alternate path |
| Different earlier process environment/runtime/configuration | Effective diagnostic configuration works; live readiness now works; live inherited environment not inspected | Sanitized same-process runtime/configuration metadata and original nested errors |
| Node/driver incompatibility | Installed engine requirements and published Node compatibility are satisfied; both client probes succeed | No current evidence supporting this hypothesis |
| Credential or permission problem | Connection/ping produced no authentication error; collection authorization not tested | Authentication or authorization error codes and read-only role inspection in Atlas |

## Atlas checklist and user actions

No Atlas control-plane session was used. Current data-plane success does not substitute for historical project configuration or audit records.

| Item | What is established | Required user-side verification |
| --- | --- | --- |
| Cluster status | Connections/pings succeeded during this check | No immediate change. If tracing the earlier incident, check whether the cluster was paused, provisioning, maintaining, or otherwise impaired at that time. |
| Network Access IP allowlist | This diagnostic path was accepted now; configured entries were not read | If the failure returns, privately compare the failing process's actual public egress IP with active project entries. Only if a mismatch is confirmed, have an authorized Atlas administrator approve/add the narrowest required entry, normally a single IPv4 `/32`. Do not open global access. |
| Database user permissions | Current connection/ping succeeded; collection roles untested | No credential reset indicated. Verify least-privilege roles privately only if endpoints later return an actual authorization error. |
| Connection-string hostname | Existing SRV/TXT discovery and target connections succeeded | No URI replacement indicated. Compare privately with the intended Atlas cluster only if project/cluster identity is in doubt. |
| Cluster availability | All three hosts completed TLS; server selection/ping succeeded | Correlate original timestamps with Atlas cluster events and service incidents if historical cause identification remains necessary. |

Atlas documents project IP access-list behavior and changing public IPs in [Configure IP Access List Entries](https://www.mongodb.com/docs/atlas/security/ip-access-list/). No allowlist edit is recommended without an observed mismatch and appropriate approval.

For a recurrence, preserve a UTC timestamp and capture the same process's sanitized error `name`, `code`, message, nested `cause`, server-selection topology, and anonymous per-host failures. Correlate those with Atlas events and network logs before changing settings. Raw error objects and stacks can expose connection details and should not be published. If code instrumentation becomes necessary, first propose an allowlisted sanitizer and obtain approval; none was added here.

## Security and preservation

- No URI, username, password, database name, private environment value, host address, or raw TXT content is included in tool output or this report.
- Certificate validation remained enabled. No invalid-certificate flags, TLS rejection override, custom insecure cipher/security setting, protocol downgrade, or alternate URI was used.
- The only explicit MongoDB command issued by the diagnostic was `ping`, once through each isolated client. Connection establishment includes the driver's normal discovery/authentication traffic; no business-data write was issued.
- No seed, ingestion, integration suite, dependency install, record update, collection deletion, index operation, or `.env` edit was run.
- The existing application and other Node.js processes remained running. Only diagnostic-owned sockets/connections were closed.
- Tracked repository files had no diff at final health verification; the pre-existing untracked frontend guide was left untouched.

**Conclusion:** the system is presently ready without changes. The earlier TLS alert remains an unresolved historical/intermittent incident, not a proven configuration defect. The safest recovery recommendation is no immediate change, with timestamped, sanitized same-process evidence and Atlas-side correlation if it recurs.
