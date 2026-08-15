/**
 * Test-environment isolation (FISH-TEST-002).
 *
 * Every test file that touches plugin logic must call `isolateEnvironment()`
 * at module load — BEFORE any plugin code runs — and security tests must
 * install the fail-closed network via `installFailClosedNetwork()` so that
 * any un-mocked upstream call fails immediately instead of leaving the
 * machine. Real credentials from the parent process (FISH_API_KEY, proxy
 * env vars) are deleted without ever being read or logged; only fictional
 * test values may be set inside tests.
 */
import { MockAgent, setGlobalDispatcher } from 'undici'

const CREDENTIAL_ENV_KEYS = ['FISH_API_KEY', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const

/** Strip real credential sources from the test process. */
export function isolateEnvironment(): void {
  for (const key of CREDENTIAL_ENV_KEYS) {
    delete process.env[key]
  }
}

/**
 * Install a global fail-closed dispatcher: any network call that is not
 * explicitly intercepted by a local mock aborts immediately (MockNotMatched
 * error) instead of reaching the network. Returns the agent so tests can add
 * explicit intercepts for the endpoints they exercise.
 */
export function installFailClosedNetwork(): MockAgent {
  const agent = new MockAgent()
  agent.disableNetConnect()
  setGlobalDispatcher(agent)
  return agent
}
