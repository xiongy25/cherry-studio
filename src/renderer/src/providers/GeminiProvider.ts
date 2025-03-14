import {
  Content,
  FileDataPart,
  FunctionCallPart,
  FunctionResponsePart,
  GenerateContentStreamResult,
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
  InlineDataPart,
  Part,
  RequestOptions,
  SafetySetting,
  TextPart
} from '@google/generative-ai'
import { isGemmaModel, isWebSearchModel } from '@renderer/config/models'
import { getStoreSetting } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import { getAssistantSettings, getDefaultModel, getTopNamingModel } from '@renderer/services/AssistantService'
import { EVENT_NAMES } from '@renderer/services/EventService'
import { filterContextMessages, filterUserRoleStartMessages } from '@renderer/services/MessagesService'
import { Assistant, FileType, FileTypes, MCPToolResponse, Message, Model, Provider, Suggestion } from '@renderer/types'
import { removeSpecialCharactersForTopicName } from '@renderer/utils'
import {
  callMCPTool,
  filterMCPTools,
  geminiFunctionCallToMcpTool,
  mcpToolsToGeminiTools,
  upsertMCPToolResponse
} from '@renderer/utils/mcp-tools'
import axios from 'axios'
import { isEmpty, takeRight } from 'lodash'
import OpenAI from 'openai'

import { CompletionsParams } from '.'
import BaseProvider from './BaseProvider'

export default class GeminiProvider extends BaseProvider {
  private sdk: GoogleGenerativeAI
  private requestOptions: RequestOptions

  constructor(provider: Provider) {
    super(provider)
    this.sdk = new GoogleGenerativeAI(this.apiKey)
    this.requestOptions = {
      baseUrl: this.getBaseURL()
    }
  }

  public getBaseURL(): string {
    return this.provider.apiHost
  }

  /**
   * Handle a PDF file
   * @param file - The file
   * @returns The part
   */
  private async handlePdfFile(file: FileType): Promise<Part> {
    const smallFileSize = 20 * 1024 * 1024
    const isSmallFile = file.size < smallFileSize

    if (isSmallFile) {
      const { data, mimeType } = await window.api.gemini.base64File(file)
      return {
        inlineData: {
          data,
          mimeType
        }
      } as InlineDataPart
    }

    // Retrieve file from Gemini uploaded files
    const fileMetadata = await window.api.gemini.retrieveFile(file, this.apiKey)

    if (fileMetadata) {
      return {
        fileData: {
          fileUri: fileMetadata.uri,
          mimeType: fileMetadata.mimeType
        }
      } as FileDataPart
    }

    // If file is not found, upload it to Gemini
    const uploadResult = await window.api.gemini.uploadFile(file, this.apiKey)

    return {
      fileData: {
        fileUri: uploadResult.file.uri,
        mimeType: uploadResult.file.mimeType
      }
    } as FileDataPart
  }

  /**
   * Get the message contents
   * @param message - The message
   * @returns The message contents
   */
  private async getMessageContents(message: Message): Promise<Content> {
    const role = message.role === 'user' ? 'user' : 'model'

    const parts: Part[] = [{ text: await this.getMessageContent(message) }]

    for (const file of message.files || []) {
      if (file.type === FileTypes.IMAGE) {
        const base64Data = await window.api.file.base64Image(file.id + file.ext)
        parts.push({
          inlineData: {
            data: base64Data.base64,
            mimeType: base64Data.mime
          }
        } as InlineDataPart)
      }

      if (file.ext === '.pdf') {
        parts.push(await this.handlePdfFile(file))
        continue
      }

      if ([FileTypes.TEXT, FileTypes.DOCUMENT].includes(file.type)) {
        const fileContent = await (await window.api.file.read(file.id + file.ext)).trim()
        parts.push({
          text: file.origin_name + '\n' + fileContent
        } as TextPart)
      }
    }

    return {
      role,
      parts
    }
  }

  /**
   * Get the safety settings
   * @param modelId - The model ID
   * @returns The safety settings
   */
  private getSafetySettings(modelId: string): SafetySetting[] {
    const safetyThreshold = modelId.includes('gemini-2.0-flash-exp')
      ? ('OFF' as HarmBlockThreshold)
      : HarmBlockThreshold.BLOCK_NONE

    return [
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: safetyThreshold
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: safetyThreshold
      },
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: safetyThreshold
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: safetyThreshold
      },
      {
        category: 'HARM_CATEGORY_CIVIC_INTEGRITY' as HarmCategory,
        threshold: safetyThreshold
      }
    ]
  }

  /**
   * Generate completions
   * @param messages - The messages
   * @param assistant - The assistant
   * @param mcpTools - The MCP tools
   * @param onChunk - The onChunk callback
   * @param onFilterMessages - The onFilterMessages callback
   */
  public async completions({ messages, assistant, mcpTools, onChunk, onFilterMessages }: CompletionsParams) {
    const defaultModel = getDefaultModel()
    const model = assistant.model || defaultModel
    const { contextCount, maxTokens, streamOutput } = getAssistantSettings(assistant)

    const userMessages = filterUserRoleStartMessages(filterContextMessages(takeRight(messages, contextCount + 2)))
    onFilterMessages(userMessages)

    const userLastMessage = userMessages.pop()

    const history: Content[] = []

    for (const message of userMessages) {
      history.push(await this.getMessageContents(message))
    }

    mcpTools = filterMCPTools(mcpTools, userLastMessage?.enabledMCPs)
    const tools = mcpToolsToGeminiTools(mcpTools)
    const toolResponses: MCPToolResponse[] = []

    if (assistant.enableWebSearch && isWebSearchModel(model)) {
      tools.push({
        // @ts-ignore googleSearch is not a valid tool for Gemini
        googleSearch: {}
      })
    }

    const geminiModel = this.sdk.getGenerativeModel(
      {
        model: model.id,
        ...(isGemmaModel(model) ? {} : { systemInstruction: assistant.prompt }),
        safetySettings: this.getSafetySettings(model.id),
        tools: tools,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: assistant?.settings?.temperature,
          topP: assistant?.settings?.topP,
          ...this.getCustomParameters(assistant)
        }
      },
      this.requestOptions
    )

    const chat = geminiModel.startChat({ history })
    const messageContents = await this.getMessageContents(userLastMessage!)

    if (isGemmaModel(model) && assistant.prompt) {
      const isFirstMessage = history.length === 0
      if (isFirstMessage) {
        const systemMessage = {
          role: 'user',
          parts: [
            {
              text:
                '<start_of_turn>user\n' +
                assistant.prompt +
                '<end_of_turn>\n' +
                '<start_of_turn>user\n' +
                messageContents.parts[0].text +
                '<end_of_turn>'
            }
          ]
        }
        messageContents.parts = systemMessage.parts
      }
    }

    const start_time_millsec = new Date().getTime()
    const { abortController, cleanup } = this.createAbortController(userLastMessage?.id)
    const { signal } = abortController

    if (!streamOutput) {
      const { response } = await chat.sendMessage(messageContents.parts, { signal })
      const time_completion_millsec = new Date().getTime() - start_time_millsec
      onChunk({
        text: response.candidates?.[0].content.parts[0].text,
        usage: {
          prompt_tokens: response.usageMetadata?.promptTokenCount || 0,
          completion_tokens: response.usageMetadata?.candidatesTokenCount || 0,
          total_tokens: response.usageMetadata?.totalTokenCount || 0
        },
        metrics: {
          completion_tokens: response.usageMetadata?.candidatesTokenCount,
          time_completion_millsec,
          time_first_token_millsec: 0
        },
        search: response.candidates?.[0]?.groundingMetadata
      })
      return
    }

    const userMessagesStream = await chat.sendMessageStream(messageContents.parts, { signal })
    let time_first_token_millsec = 0

    const processStream = async (stream: GenerateContentStreamResult, idx: number) => {
      for await (const chunk of stream.stream) {
        if (window.keyv.get(EVENT_NAMES.CHAT_COMPLETION_PAUSED)) break

        if (time_first_token_millsec == 0) {
          time_first_token_millsec = new Date().getTime() - start_time_millsec
        }

        const time_completion_millsec = new Date().getTime() - start_time_millsec

        const functionCalls = chunk.functionCalls()

        if (functionCalls) {
          const fcallParts: FunctionCallPart[] = []
          const fcRespParts: FunctionResponsePart[] = []
          for (const call of functionCalls) {
            console.log('Function call:', call)
            fcallParts.push({ functionCall: call } as FunctionCallPart)
            const mcpTool = geminiFunctionCallToMcpTool(mcpTools, call)
            if (mcpTool) {
              upsertMCPToolResponse(
                toolResponses,
                {
                  tool: mcpTool,
                  status: 'invoking',
                  id: `${call.name}-${idx}`
                },
                onChunk
              )
              const toolCallResponse = await callMCPTool(mcpTool)
              fcRespParts.push({
                functionResponse: {
                  name: mcpTool.id,
                  response: toolCallResponse
                }
              })
              upsertMCPToolResponse(
                toolResponses,
                {
                  tool: mcpTool,
                  status: 'done',
                  response: toolCallResponse,
                  id: `${call.name}-${idx}`
                },
                onChunk
              )
            }
          }

          if (fcRespParts) {
            history.push(messageContents)
            history.push({
              role: 'model',
              parts: fcallParts
            })
            const newChat = geminiModel.startChat({ history })
            const newStream = await newChat.sendMessageStream(fcRespParts, { signal })
            await processStream(newStream, idx + 1).finally(cleanup)
          }
        }

        onChunk({
          text: chunk.text(),
          usage: {
            prompt_tokens: chunk.usageMetadata?.promptTokenCount || 0,
            completion_tokens: chunk.usageMetadata?.candidatesTokenCount || 0,
            total_tokens: chunk.usageMetadata?.totalTokenCount || 0
          },
          metrics: {
            completion_tokens: chunk.usageMetadata?.candidatesTokenCount,
            time_completion_millsec,
            time_first_token_millsec
          },
          search: chunk.candidates?.[0]?.groundingMetadata,
          mcpToolResponse: toolResponses
        })
      }
    }

    await processStream(userMessagesStream, 0).finally(cleanup)
  }

  /**
   * Translate a message
   * @param message - The message
   * @param assistant - The assistant
   * @param onResponse - The onResponse callback
   * @returns The translated message
   */
  async translate(message: Message, assistant: Assistant, onResponse?: (text: string) => void) {
    const defaultModel = getDefaultModel()
    const { maxTokens } = getAssistantSettings(assistant)
    const model = assistant.model || defaultModel

    const geminiModel = this.sdk.getGenerativeModel(
      {
        model: model.id,
        ...(isGemmaModel(model) ? {} : { systemInstruction: assistant.prompt }),
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: assistant?.settings?.temperature
        }
      },
      this.requestOptions
    )

    const content =
      isGemmaModel(model) && assistant.prompt
        ? `<start_of_turn>user\n${assistant.prompt}<end_of_turn>\n<start_of_turn>user\n${message.content}<end_of_turn>`
        : message.content

    if (!onResponse) {
      const { response } = await geminiModel.generateContent(content)
      return response.text()
    }

    const response = await geminiModel.generateContentStream(content)

    let text = ''

    for await (const chunk of response.stream) {
      text += chunk.text()
      onResponse(text)
    }

    return text
  }

  /**
   * Summarize a message
   * @param messages - The messages
   * @param assistant - The assistant
   * @returns The summary
   */
  public async summaries(messages: Message[], assistant: Assistant): Promise<string> {
    const model = getTopNamingModel() || assistant.model || getDefaultModel()

    const userMessages = takeRight(messages, 5)
      .filter((message) => !message.isPreset)
      .map((message) => ({
        role: message.role,
        content: message.content
      }))

    const userMessageContent = userMessages.reduce((prev, curr) => {
      const content = curr.role === 'user' ? `User: ${curr.content}` : `Assistant: ${curr.content}`
      return prev + (prev ? '\n' : '') + content
    }, '')

    const systemMessage = {
      role: 'system',
      content: (getStoreSetting('topicNamingPrompt') as string) || i18n.t('prompts.title')
    }

    const userMessage = {
      role: 'user',
      content: userMessageContent
    }

    const geminiModel = this.sdk.getGenerativeModel(
      {
        model: model.id,
        ...(isGemmaModel(model) ? {} : { systemInstruction: systemMessage.content }),
        generationConfig: {
          temperature: assistant?.settings?.temperature
        }
      },
      this.requestOptions
    )

    const chat = await geminiModel.startChat()
    const content = isGemmaModel(model)
      ? `<start_of_turn>user\n${systemMessage.content}<end_of_turn>\n<start_of_turn>user\n${userMessage.content}<end_of_turn>`
      : userMessage.content

    const { response } = await chat.sendMessage(content)

    return removeSpecialCharactersForTopicName(response.text())
  }

  /**
   * Generate text
   * @param prompt - The prompt
   * @param content - The content
   * @returns The generated text
   */
  public async generateText({ prompt, content }: { prompt: string; content: string }): Promise<string> {
    const model = getDefaultModel()
    const systemMessage = { role: 'system', content: prompt }

    const geminiModel = this.sdk.getGenerativeModel(
      {
        model: model.id,
        ...(isGemmaModel(model) ? {} : { systemInstruction: systemMessage.content })
      },
      this.requestOptions
    )

    const chat = await geminiModel.startChat()
    const messageContent = isGemmaModel(model)
      ? `<start_of_turn>user\n${prompt}<end_of_turn>\n<start_of_turn>user\n${content}<end_of_turn>`
      : content

    const { response } = await chat.sendMessage(messageContent)

    return response.text()
  }

  /**
   * Generate suggestions
   * @returns The suggestions
   */
  public async suggestions(): Promise<Suggestion[]> {
    return []
  }

  /**
   * Generate an image
   * @returns The generated image
   */
  public async generateImage(): Promise<string[]> {
    return []
  }

  /**
   * Check if the model is valid
   * @param model - The model
   * @returns The validity of the model
   */
  public async check(model: Model): Promise<{ valid: boolean; error: Error | null }> {
    if (!model) {
      return { valid: false, error: new Error('No model found') }
    }

    const body = {
      model: model.id,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 100,
      stream: false
    }

    try {
      const geminiModel = this.sdk.getGenerativeModel({ model: body.model }, this.requestOptions)
      const result = await geminiModel.generateContent(body.messages[0].content)
      return {
        valid: !isEmpty(result.response.text()),
        error: null
      }
    } catch (error: any) {
      return {
        valid: false,
        error
      }
    }
  }

  /**
   * Get the models
   * @returns The models
   */
  public async models(): Promise<OpenAI.Models.Model[]> {
    try {
      const api = this.provider.apiHost + '/v1beta/models'
      const { data } = await axios.get(api, { params: { key: this.apiKey } })

      return data.models.map(
        (m) =>
          ({
            id: m.name.replace('models/', ''),
            name: m.displayName,
            description: m.description,
            object: 'model',
            created: Date.now(),
            owned_by: 'gemini'
          }) as OpenAI.Models.Model
      )
    } catch (error) {
      return []
    }
  }

  /**
   * Get the embedding dimensions
   * @param model - The model
   * @returns The embedding dimensions
   */
  public async getEmbeddingDimensions(model: Model): Promise<number> {
    const data = await this.sdk.getGenerativeModel({ model: model.id }, this.requestOptions).embedContent('hi')
    return data.embedding.values.length
  }
}
