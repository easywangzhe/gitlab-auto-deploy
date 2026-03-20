/**
 * Prometheus Metrics Service - Export metrics for monitoring
 */

import * as http from 'http'
import { logger } from '../utils/logger'

export interface MetricsConfig {
  enabled: boolean
  port: number
  path: string
}

interface MetricValue {
  value: number
  labels: Record<string, string>
}

interface CounterMetric {
  type: 'counter'
  name: string
  help: string
  values: MetricValue[]
}

interface GaugeMetric {
  type: 'gauge'
  name: string
  help: string
  values: MetricValue[]
}

interface HistogramMetric {
  type: 'histogram'
  name: string
  help: string
  buckets: number[]
  values: Array<{ labels: Record<string, string>; observations: number[] }>
}

type Metric = CounterMetric | GaugeMetric | HistogramMetric

class PrometheusMetricsService {
  private server: http.Server | null = null
  private metrics: Map<string, Metric> = new Map()
  private config: MetricsConfig = {
    enabled: false,
    port: 9090,
    path: '/metrics'
  }

  /**
   * Initialize metrics service
   */
  async initialize(config?: Partial<MetricsConfig>): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config }
    }

    // Register default metrics
    this.registerCounter(
      'gitlab_deploy_deployment_total',
      'Total number of deployments',
      ['status', 'project']
    )

    this.registerCounter(
      'gitlab_deploy_deployment_duration_seconds',
      'Duration of deployments in seconds',
      ['project', 'status']
    )

    this.registerGauge(
      'gitlab_deploy_deployment_in_progress',
      'Number of deployments currently in progress',
      ['project']
    )

    this.registerGauge(
      'gitlab_deploy_queue_size',
      'Number of deployments in queue',
      []
    )

    this.registerGauge(
      'gitlab_deploy_daemon_status',
      'Daemon status (1=running, 0=stopped)',
      []
    )

    this.registerCounter(
      'gitlab_deploy_webhook_sent_total',
      'Total number of webhooks sent',
      ['event', 'status']
    )

    this.registerCounter(
      'gitlab_deploy_gitlab_api_requests_total',
      'Total number of GitLab API requests',
      ['endpoint', 'status']
    )

    this.registerHistogram(
      'gitlab_deploy_gitlab_api_duration_seconds',
      'Duration of GitLab API requests in seconds',
      ['endpoint'],
      [0.1, 0.5, 1, 2, 5, 10]
    )

    if (this.config.enabled) {
      await this.startServer()
    }

    logger.info('metrics', 'Prometheus metrics service initialized', {
      enabled: this.config.enabled,
      port: this.config.port
    })
  }

  /**
   * Start HTTP server for metrics endpoint
   */
  private async startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        if (req.url === this.config.path && req.method === 'GET') {
          const metrics = this.export()
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end(metrics)
        } else {
          res.writeHead(404)
          res.end('Not Found')
        }
      })

      this.server.listen(this.config.port, () => {
        logger.info('metrics', `Metrics server started on port ${this.config.port}`)
        resolve()
      })

      this.server.on('error', (error) => {
        logger.error('metrics', 'Metrics server error', { error: error.message })
        reject(error)
      })
    })
  }

  /**
   * Stop HTTP server
   */
  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve, reject) => {
        this.server!.close((error) => {
          if (error) {
            reject(error)
          } else {
            this.server = null
            resolve()
          }
        })
      })
    }
  }

  /**
   * Register a counter metric
   */
  registerCounter(name: string, help: string, labelNames: string[]): void {
    this.metrics.set(name, {
      type: 'counter',
      name,
      help,
      values: []
    })
  }

  /**
   * Register a gauge metric
   */
  registerGauge(name: string, help: string, labelNames: string[]): void {
    this.metrics.set(name, {
      type: 'gauge',
      name,
      help,
      values: []
    })
  }

  /**
   * Register a histogram metric
   */
  registerHistogram(name: string, help: string, labelNames: string[], buckets: number[]): void {
    this.metrics.set(name, {
      type: 'histogram',
      name,
      help,
      buckets,
      values: []
    })
  }

  /**
   * Increment a counter
   */
  incrementCounter(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    const metric = this.metrics.get(name)
    if (!metric || metric.type !== 'counter') {
      logger.warn('metrics', `Counter not found: ${name}`)
      return
    }

    const labelKey = this.getLabelKey(labels)
    const existing = metric.values.find(v => this.getLabelKey(v.labels) === labelKey)

    if (existing) {
      existing.value += value
    } else {
      metric.values.push({ value, labels })
    }
  }

  /**
   * Set a gauge value
   */
  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const metric = this.metrics.get(name)
    if (!metric || metric.type !== 'gauge') {
      logger.warn('metrics', `Gauge not found: ${name}`)
      return
    }

    const labelKey = this.getLabelKey(labels)
    const existing = metric.values.find(v => this.getLabelKey(v.labels) === labelKey)

    if (existing) {
      existing.value = value
    } else {
      metric.values.push({ value, labels })
    }
  }

  /**
   * Observe a value for histogram
   */
  observe(name: string, value: number, labels: Record<string, string> = {}): void {
    const metric = this.metrics.get(name)
    if (!metric || metric.type !== 'histogram') {
      logger.warn('metrics', `Histogram not found: ${name}`)
      return
    }

    const labelKey = this.getLabelKey(labels)
    const existing = metric.values.find(v => this.getLabelKey(v.labels) === labelKey)

    if (existing) {
      existing.observations.push(value)
    } else {
      metric.values.push({ labels, observations: [value] })
    }
  }

  /**
   * Track deployment duration
   */
  trackDeploymentDuration(projectId: string, status: string, durationSeconds: number): void {
    this.incrementCounter('gitlab_deploy_deployment_total', { status, project: projectId })
    this.incrementCounter('gitlab_deploy_deployment_duration_seconds', { project: projectId, status }, durationSeconds)
  }

  /**
   * Update deployment queue size
   */
  updateQueueSize(size: number): void {
    this.setGauge('gitlab_deploy_queue_size', size)
  }

  /**
   * Update daemon status
   */
  updateDaemonStatus(running: boolean): void {
    this.setGauge('gitlab_deploy_daemon_status', running ? 1 : 0)
  }

  /**
   * Track in-progress deployments
   */
  updateInProgressDeployments(projectId: string, count: number): void {
    this.setGauge('gitlab_deploy_deployment_in_progress', count, { project: projectId })
  }

  /**
   * Track webhook sent
   */
  trackWebhookSent(event: string, success: boolean): void {
    this.incrementCounter('gitlab_deploy_webhook_sent_total', {
      event,
      status: success ? 'success' : 'failed'
    })
  }

  /**
   * Track GitLab API request
   */
  trackGitLabApiRequest(endpoint: string, status: number, durationSeconds: number): void {
    this.incrementCounter('gitlab_deploy_gitlab_api_requests_total', {
      endpoint,
      status: status.toString()
    })
    this.observe('gitlab_deploy_gitlab_api_duration_seconds', durationSeconds, { endpoint })
  }

  /**
   * Export metrics in Prometheus format
   */
  export(): string {
    const lines: string[] = []

    for (const metric of this.metrics.values()) {
      lines.push(`# HELP ${metric.name} ${metric.help}`)
      lines.push(`# TYPE ${metric.name} ${metric.type}`)

      if (metric.type === 'histogram') {
        for (const value of metric.values) {
          const labels = this.formatLabels(value.labels)
          const observations = value.observations

          // Count observations in each bucket
          let cumulativeCount = 0
          for (const bucket of metric.buckets) {
            const count = observations.filter(o => o <= bucket).length
            cumulativeCount += count
            lines.push(`${metric.name}_bucket${labels}{le="${bucket}"} ${cumulativeCount}`)
          }
          lines.push(`${metric.name}_bucket${labels}{le="+Inf"} ${observations.length}`)
          lines.push(`${metric.name}_count${labels} ${observations.length}`)
          lines.push(`${metric.name}_sum${labels} ${observations.reduce((a, b) => a + b, 0)}`)
        }
      } else {
        for (const value of metric.values) {
          const labels = this.formatLabels(value.labels)
          lines.push(`${metric.name}${labels} ${value.value}`)
        }
      }

      lines.push('')
    }

    return lines.join('\n')
  }

  /**
   * Format labels for Prometheus
   */
  private formatLabels(labels: Record<string, string>): string {
    const keys = Object.keys(labels)
    if (keys.length === 0) return ''

    const pairs = keys.map(k => `${k}="${labels[k]}"`)
    return `{${pairs.join(',')}}`
  }

  /**
   * Get label key for matching
   */
  private getLabelKey(labels: Record<string, string>): string {
    return JSON.stringify(labels)
  }

  /**
   * Get metrics configuration
   */
  getConfig(): MetricsConfig {
    return { ...this.config }
  }

  /**
   * Update metrics configuration
   */
  updateConfig(config: Partial<MetricsConfig>): void {
    const wasEnabled = this.config.enabled
    this.config = { ...this.config, ...config }

    // Start/stop server if enabled state changed
    if (config.enabled !== undefined && config.enabled !== wasEnabled) {
      if (config.enabled && !this.server) {
        this.startServer().catch(error => {
          logger.error('metrics', 'Failed to start metrics server', { error: error.message })
        })
      } else if (!config.enabled && this.server) {
        this.stop().catch(error => {
          logger.error('metrics', 'Failed to stop metrics server', { error: error.message })
        })
      }
    }
  }
}

// Singleton instance
export const prometheusMetrics = new PrometheusMetricsService()