import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../app.module';
import {
  CLOUD_PROVIDER_CLIENT_FACTORY,
  CloudProvider,
  CloudProviderClientFactory,
} from '../../monitoring/cloud/cloud-provider-client';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Cloud billing providers verification FAILED: ${message}`);
  }
  console.log(`  OK  ${message}`);
}

/**
 * Proves the billing pipeline is provider-agnostic across all six providers:
 * the real factory builds a conforming client for each, and the newly-added
 * ones (gcp/alibaba/digitalocean/oracle) return an empty billing set gracefully
 * when unconfigured rather than throwing, so a misconfigured account never
 * breaks a multi-account sync pass.
 */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const factory = app.get<CloudProviderClientFactory>(
    CLOUD_PROVIDER_CLIENT_FACTORY,
  );

  try {
    // aws/azure clients need real SDK credentials just to construct, so they're
    // covered by cost-sync/cloud-polling (fake-swapped); here we prove the four
    // newly-added providers build and ingest through the same contract.
    const newProviders: CloudProvider[] = [
      'gcp',
      'alibaba',
      'digitalocean',
      'oracle',
    ];
    for (const provider of newProviders) {
      const client = factory(provider, {});
      assert(
        client.provider === provider,
        `factory builds a ${provider} client with the right provider tag`,
      );
      const items = await client.getCostAndUsage('2026-01-01', '2026-02-01');
      assert(
        Array.isArray(items) && items.length === 0,
        `${provider} getCostAndUsage returns [] gracefully when unconfigured`,
      );
      const resources = await client.listResources();
      assert(
        Array.isArray(resources) && resources.length === 0,
        `${provider} listResources returns [] (billing-only client)`,
      );
    }

    console.log('\nAll cloud billing provider checks passed.');
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
