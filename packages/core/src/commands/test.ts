/**
 * test command - Run Hestia test suite
 * Usage: hestia test [options]
 *        hestia test:unit
 *        hestia test:integration
 *        hestia test:e2e
 *        hestia test:smoke
 *        hestia test:watch
 *        hestia test:ci
 */

import { Command } from "commander";
import chalk from "chalk";
import { HestiaTestSuite, TestCategory, TestSuiteConfig, TestSuiteReport } from '../domains/shared/lib/test-suite.js';
import { logger } from '../lib/utils/index';

interface TestOptions {
  category?: string;
  test?: string;
  watch?: boolean;
  ci?: boolean;
  parallel?: boolean;
  verbose?: boolean;
}

/**
 * Format test name for display
 */
function formatTestName(name: string): string {
  // Convert camelCase to readable format
  return name
    .replace(/^test/, "")
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase();
}

/**
 * Display a progress bar
 */
function showProgressBar(current: number, total: number, label?: string): void {
  const percentage = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * 20);
  const bar = chalk.green("█".repeat(filled)) + chalk.gray("░".repeat(20 - filled));
  const prefix = label ? `${label} ` : "";
  process.stdout.write(`\r${prefix}${bar} ${percentage}% (${current}/${total})`);
  if (current === total) {
    process.stdout.write("\n");
  }
}

/**
 * Display a single test result
 */
function displayTestResult(result: {
  passed: boolean;
  name: string;
  duration: number;
  error?: string;
  logs: string[];
}, verbose: boolean): void {
  const icon = result.passed ? chalk.green("✓") : chalk.red("✗");
  const name = formatTestName(result.name);
  const duration = chalk.gray(`${result.duration}ms`);

  console.log(`  ${icon} ${name} ${duration}`);

  if (!result.passed && result.error) {
    console.log(chalk.red(`    Error: ${result.error}`));
  }

  if (verbose && result.logs.length > 0) {
    for (const log of result.logs.slice(0, 5)) {
      console.log(chalk.gray(`    ${log}`));
    }
    if (result.logs.length > 5) {
      console.log(chalk.gray(`    ... and ${result.logs.length - 5} more log lines`));
    }
  }
}

/**
 * Display the full test report
 */
function displayReport(report: TestSuiteReport, verbose: boolean): void {
  logger.newline();
  logger.header("Test Suite Report");
  logger.newline();

  // Summary
  const total = report.summary.total;
  const passed = report.summary.passed;
  const failed = report.summary.failed;
  const duration = report.summary.duration;

  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";

  console.log(`${chalk.bold("Total:")} ${total}`);
  console.log(`${chalk.bold("Passed:")} ${chalk.green(passed.toString())}`);
  console.log(`${chalk.bold("Failed:")} ${failed > 0 ? chalk.red(failed.toString()) : chalk.gray("0")}`);
  console.log(`${chalk.bold("Pass Rate:")} ${passRate}%`);
  console.log(`${chalk.bold("Duration:")} ${duration}ms`);

  // Results by category
  logger.newline();
  logger.section("Results by Category");

  const categories: TestCategory[] = ["unit", "integration", "e2e", "smoke"];
  for (const category of categories) {
    const stats = report.byCategory[category];
    if (stats && (stats.passed + stats.failed > 0)) {
      const icon = stats.failed === 0 ? chalk.green("✓") : chalk.yellow("⚠");
      const totalInCat = stats.passed + stats.failed;
      console.log(`  ${icon} ${category}: ${stats.passed}/${totalInCat} (${stats.duration}ms)`);

      // Show individual test results for this category
      const categoryResults = report.results.filter((r) => r.category === category);
      for (const result of categoryResults) {
        displayTestResult(result, verbose);
      }
      console.log();
    }
  }

  // Failed tests section
  if (report.failedTests.length > 0) {
    logger.newline();
    logger.section("Failed Tests");
    for (const test of report.failedTests) {
      console.log(chalk.red(`  ✗ ${test.name}`));
      if (test.error) {
        console.log(chalk.red(`    ${test.error}`));
      }
    }
  }

  // Slow tests
  if (report.slowTests.length > 0) {
    logger.newline();
    logger.section("Slow Tests (>1000ms)");
    for (const test of report.slowTests.slice(0, 5)) {
      console.log(`  ⚠ ${test.name}: ${test.duration}ms`);
    }
  }

  // Flaky tests (required retries)
  if (report.flakyTests.length > 0) {
    logger.newline();
    logger.section("Flaky Tests (required retries)");
    for (const test of report.flakyTests) {
      console.log(`  ⚠ ${test.name}: ${test.retries} retries`);
    }
  }

  // Coverage (if available)
  if (report.coverage) {
    logger.newline();
    logger.section("Coverage");
    console.log(`  Lines: ${report.coverage.lines}%`);
    console.log(`  Functions: ${report.coverage.functions}%`);
    console.log(`  Branches: ${report.coverage.branches}%`);
  }

  logger.newline();
  if (failed === 0) {
    logger.success("All tests passed! ✓");
  } else {
    logger.error(`${failed} test(s) failed ✗`);
  }
}

/**
 * Run tests with progress display
 */
async function runTestsWithProgress(
  suite: HestiaTestSuite,
  options: TestSuiteConfig,
  category?: TestCategory
): Promise<TestSuiteReport> {
  logger.header(category ? `Running ${category.toUpperCase()} Tests` : "Running Test Suite");
  logger.newline();

  // Progress callback would be set here if the suite supported it
  // For now, we run the tests and display the report
  let report: TestSuiteReport;

  if (category) {
    report = await suite.runTests(category);
  } else {
    report = await suite.runAllTests();
  }

  return report;
}

/**
 * Main test command registration
 */
export function testCommand(program: Command): void {
  // Default test command - run all tests
  program
    .command("test")
    .description("Run the test suite")
    .option("-c, --category <cat>", "Filter tests by category (unit|integration|e2e|smoke)")
    .option("-t, --test <name>", "Run specific test by name")
    .option("-w, --watch", "Run in watch mode (rerun on file changes)")
    .option("--ci", "Run in CI mode (JSON output, no colors)")
    .option("-p, --parallel", "Run tests in parallel")
    .option("-v, --verbose", "Show verbose output")
    .action(async (options: TestOptions) => {
      try {
        const config: Partial<TestSuiteConfig> = {
          parallel: options.parallel ?? true,
          verbose: options.verbose ?? false,
          ciMode: options.ci ?? false,
          watch: options.watch ?? false,
        };

        const suite = new HestiaTestSuite(config);

        // Watch mode
        if (options.watch) {
          logger.info("Starting watch mode...");
          await suite.watchMode();
          return;
        }

        // CI mode
        if (options.ci) {
          const report = await suite.ciMode();
          process.exit(report.summary.failed > 0 ? 1 : 0);
          return;
        }

        // Single test
        if (options.test) {
          logger.header(`Running Test: ${options.test}`);
          const result = await suite.runTest(options.test);
          displayTestResult(result, options.verbose ?? false);
          process.exit(result.passed ? 0 : 1);
          return;
        }

        // Category or all tests
        const category = options.category as TestCategory | undefined;
        const report = await runTestsWithProgress(suite, config as TestSuiteConfig, category);
        displayReport(report, options.verbose ?? false);

        // Exit with appropriate code
        process.exit(report.summary.failed > 0 ? 1 : 0);
      } catch (error) {
        logger.error(`Test suite failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // Unit tests
  program
    .command("test:unit")
    .description("Run unit tests only")
    .option("-v, --verbose", "Show verbose output")
    .option("-p, --parallel", "Run tests in parallel")
    .action(async (options: { verbose?: boolean; parallel?: boolean }) => {
      try {
        const config: Partial<TestSuiteConfig> = {
          parallel: options.parallel ?? true,
          verbose: options.verbose ?? false,
          ciMode: false,
        };

        const suite = new HestiaTestSuite(config);
        const report = await runTestsWithProgress(suite, config as TestSuiteConfig, "unit");
        displayReport(report, options.verbose ?? false);

        process.exit(report.summary.failed > 0 ? 1 : 0);
      } catch (error) {
        logger.error(`Unit tests failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // Integration tests
  program
    .command("test:integration")
    .description("Run integration tests only")
    .option("-v, --verbose", "Show verbose output")
    .option("-p, --parallel", "Run tests in parallel")
    .action(async (options: { verbose?: boolean; parallel?: boolean }) => {
      try {
        const config: Partial<TestSuiteConfig> = {
          parallel: options.parallel ?? true,
          verbose: options.verbose ?? false,
          ciMode: false,
        };

        const suite = new HestiaTestSuite(config);
        const report = await runTestsWithProgress(suite, config as TestSuiteConfig, "integration");
        displayReport(report, options.verbose ?? false);

        process.exit(report.summary.failed > 0 ? 1 : 0);
      } catch (error) {
        logger.error(`Integration tests failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // End-to-end tests
  program
    .command("test:e2e")
    .description("Run end-to-end tests only")
    .option("-v, --verbose", "Show verbose output")
    .option("-p, --parallel", "Run tests in parallel")
    .action(async (options: { verbose?: boolean; parallel?: boolean }) => {
      try {
        const config: Partial<TestSuiteConfig> = {
          parallel: options.parallel ?? true,
          verbose: options.verbose ?? false,
          ciMode: false,
        };

        const suite = new HestiaTestSuite(config);
        const report = await runTestsWithProgress(suite, config as TestSuiteConfig, "e2e");
        displayReport(report, options.verbose ?? false);

        process.exit(report.summary.failed > 0 ? 1 : 0);
      } catch (error) {
        logger.error(`E2E tests failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // Smoke tests
  program
    .command("test:smoke")
    .description("Run smoke tests only (quick sanity check)")
    .option("-v, --verbose", "Show verbose output")
    .action(async (options: { verbose?: boolean }) => {
      try {
        const config: Partial<TestSuiteConfig> = {
          parallel: false,
          verbose: options.verbose ?? false,
          ciMode: false,
        };

        const suite = new HestiaTestSuite(config);
        logger.info("Running smoke tests... (this should be quick)");
        const report = await runTestsWithProgress(suite, config as TestSuiteConfig, "smoke");
        displayReport(report, options.verbose ?? false);

        process.exit(report.summary.failed > 0 ? 1 : 0);
      } catch (error) {
        logger.error(`Smoke tests failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // Watch mode
  program
    .command("test:watch")
    .description("Run tests in watch mode (rerun on file changes)")
    .option("-c, --category <cat>", "Filter tests by category (unit|integration|e2e|smoke)")
    .action(async (options: { category?: string }) => {
      try {
        const config: Partial<TestSuiteConfig> = {
          watch: true,
          verbose: false,
          ciMode: false,
        };

        // Add category filter if provided
        if (options.category) {
          config.filter = options.category;
        }

        const suite = new HestiaTestSuite(config);
        logger.info("Starting test watch mode...");
        logger.info("Press Ctrl+C to stop\n");

        await suite.watchMode();
      } catch (error) {
        logger.error(`Watch mode failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // CI mode
  program
    .command("test:ci")
    .description("Run tests in CI mode (JSON output, no colors, exit codes only)")
    .option("-c, --category <cat>", "Filter tests by category (unit|integration|e2e|smoke)")
    .action(async (options: { category?: string }) => {
      try {
        const config: Partial<TestSuiteConfig> = {
          ciMode: true,
          verbose: false,
          parallel: true,
        };

        const suite = new HestiaTestSuite(config);

        let report: TestSuiteReport;
        if (options.category) {
          report = await suite.runTests(options.category as TestCategory);
        } else {
          report = await suite.runAllTests();
        }

        // Output JSON to stdout
        console.log(JSON.stringify(report, null, 2));

        // Exit with appropriate code
        process.exit(report.summary.failed > 0 ? 1 : 0);
      } catch (error) {
        // In CI mode, output error as JSON
        const errorReport = {
          error: error instanceof Error ? error.message : String(error),
          summary: {
            total: 0,
            passed: 0,
            failed: 1,
            duration: 0,
          },
        };
        console.log(JSON.stringify(errorReport, null, 2));
        process.exit(1);
      }
    });
}

export default testCommand;
