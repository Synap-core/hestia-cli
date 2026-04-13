import { Command } from 'commander'
import chalk from 'chalk'
import { EntityStateManager, OrganRegistry } from '@hestia/dna'

export function doctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Run diagnostics on the entity')
    .action(async () => {
      try {
        console.log(chalk.cyan('\n🏥 Running Entity Diagnostics...\n'))

        const state = await EntityStateManager.getState()
        const issues: string[] = []

        // Check each organ's health
        const organs = ['brain', 'heart', 'lungs', 'hands', 'legs', 'skin']
        for (const organ of organs) {
          const organState = state[organ]
          if (!organState) {
            issues.push(`${organ}: Missing state`)
            console.log(chalk.red(`✗ ${organ}: No state found`))
          } else if (organState.status === 'error') {
            issues.push(`${organ}: Error state`)
            console.log(chalk.red(`✗ ${organ}: Error - ${organState.message || 'Unknown error'}`))
          } else if (organState.status === 'warning') {
            console.log(chalk.yellow(`⚠ ${organ}: Warning - ${organState.message || 'Check recommended'}`))
          } else {
            console.log(chalk.green(`✓ ${organ}: Healthy`))
          }
        }

        console.log()

        if (issues.length === 0) {
          console.log(chalk.green('✓ Entity is healthy!'))
        } else {
          console.log(chalk.yellow(`⚠ Found ${issues.length} issue(s)`))
        }

        console.log()
      } catch (error) {
        console.error(chalk.red('Diagnostics failed:'), error)
        process.exit(1)
      }
    })
}