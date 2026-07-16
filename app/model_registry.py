MODEL_MAP: dict[str, str] = {
    "claude-opus4.6": "avocado-froyo-medium",
    "claude-opus4.7": "apricot-sorbet-high",
    "claude-opus4.8": "ambrosia-tart-high",
    "claude-sonnet4.6": "almond-croissant-low",
    "claude-sonnet5": "angel-cake-high",
    "claude-haiku4.5": "anthropic-haiku-4.5",
    "gemini-2.5flash": "vertex-gemini-2.5-flash",
    "gemini-3.1pro": "galette-medium-thinking",
    "gemini-3.5flash": "vertex-gemini-3.5-flash",
    "gemini-3-flash": "gingerbread",
    "gpt-5.2": "oatmeal-cookie",
    "gpt-5.4": "oval-kumquat-medium",
    "gpt-5.4-mini": "oregon-grape-medium",
    "gpt-5.4-nano": "otaheite-apple-medium",
    "gpt-5.5": "opal-quince-medium",
    "gpt-5.6-sol": "orange-mousse",
    "gpt-5.6-terra": "orchid-muffin",
    "gpt-5.6-luna": "olive-jellyroll",
    "kimi-2.6": "fireworks-kimi-k2.6",
    "kimi-2.7-code": "fireworks-kimi-k2.7",
    "grok-4.3": "xigua-mochi-medium",
    "grok-spacexai4.5": "strawberry-whoopiepie",
    "grok-build0.1": "xinomavro-cake",
    "deepseek-v4pro": "baseten-deepseek-v4-pro",
    "glm-5.2": "baseten-glm-5.2",
    "fable-5": "acai-budino-high",
}

# Reverse lookup: Notion internal id → public id (for get_standard_model)
NOTION_MODEL_REVERSE_MAP: dict[str, str] = {value: key for key, value in MODEL_MAP.items()}

DISPLAY_NAMES: dict[str, str] = {
    "claude-opus4.6": "Claude Opus 4.6",
    "claude-opus4.7": "Claude Opus 4.7",
    "claude-opus4.8": "Claude Opus 4.8",
    "claude-sonnet4.6": "Claude Sonnet 4.6",
    "claude-sonnet5": "Claude Sonnet 5",
    "claude-haiku4.5": "Claude Haiku 4.5",
    "gemini-2.5flash": "Gemini 2.5 Flash",
    "gemini-3.1pro": "Gemini 3.1 Pro",
    "gemini-3.5flash": "Gemini 3.5 Flash",
    "gemini-3-flash": "Gemini 3 Flash",
    "gpt-5.2": "GPT-5.2",
    "gpt-5.4": "GPT-5.4",
    "gpt-5.4-mini": "GPT-5.4 Mini",
    "gpt-5.4-nano": "GPT-5.4 Nano",
    "gpt-5.5": "GPT-5.5",
    "gpt-5.6-sol": "GPT-5.6 Sol",
    "gpt-5.6-terra": "GPT-5.6 Terra",
    "gpt-5.6-luna": "GPT-5.6 Luna",
    "kimi-2.6": "Kimi 2.6",
    "kimi-2.7-code": "Kimi 2.7 Code",
    "grok-4.3": "Grok 4.3",
    "grok-spacexai4.5": "SpaceXAI 4.5",
    "grok-build0.1": "Grok Build 0.1",
    "deepseek-v4pro": "DeepSeek V4 Pro",
    "glm-5.2": "GLM 5.2",
    "fable-5": "Fable 5",
}


MODEL_ICONS: dict[str, str] = {
    "claude-opus4.6": "✳️",
    "claude-opus4.7": "✳️",
    "claude-opus4.8": "✳️",
    "claude-sonnet4.6": "✳️",
    "claude-sonnet5": "✳️",
    "claude-haiku4.5": "✳️",
    "gemini-2.5flash": "✦",
    "gemini-3.1pro": "✦",
    "gemini-3.5flash": "✦",
    "gemini-3-flash": "✦",
    "gpt-5.2": "⚙️",
    "gpt-5.4": "⚙️",
    "gpt-5.4-mini": "⚙️",
    "gpt-5.4-nano": "⚙️",
    "gpt-5.5": "⚙️",
    "gpt-5.6-sol": "⚙️",
    "gpt-5.6-terra": "⚙️",
    "gpt-5.6-luna": "⚙️",
    "kimi-2.6": "",
    "kimi-2.7-code": "",
    "grok-4.3": "⚡️",
    "grok-spacexai4.5": "⚡️",
    "grok-build0.1": "⚡️",
    "deepseek-v4pro": "",
    "glm-5.2": "",
    "fable-5": "✳️",
}

# Default to Sonnet 4.6 (best balance of speed and quality)
DEFAULT_MODEL = "claude-sonnet4.6"


def get_notion_model(model_name: str) -> str:
    return MODEL_MAP.get(model_name, MODEL_MAP[DEFAULT_MODEL])


# Notion internal ids that use markdown-chat (vertex-prefixed models)
# Gemini 3.1 Pro (galette-medium-thinking) switched to workflow; no longer uses markdown-chat
MARKDOWN_CHAT_MODELS: set[str] = {
    "vertex-gemini-2.5-flash",
}


def is_gemini_model(model_name: str) -> bool:
    """Whether this is a Gemini-family model (config block building, etc.)"""
    standard_name = get_standard_model(model_name)
    if standard_name.startswith("gemini-"):
        return True
    notion_model = get_notion_model(standard_name)
    return notion_model.startswith("vertex-") or notion_model.startswith("galette-")


def get_thread_type(model_name: str) -> str:
    """
    Resolve Notion thread type from the model.
    Only vertex-prefixed models use markdown-chat; everything else uses workflow.
    """
    standard_name = get_standard_model(model_name)
    notion_model = get_notion_model(standard_name)
    if notion_model in MARKDOWN_CHAT_MODELS:
        return "markdown-chat"
    return "workflow"


def get_standard_model(model_name: str) -> str:
    if model_name in MODEL_MAP:
        return model_name
    return NOTION_MODEL_REVERSE_MAP.get(model_name, DEFAULT_MODEL)


def list_available_models() -> list[str]:
    return list(MODEL_MAP.keys())


def is_supported_model(model_name: str) -> bool:
    return model_name in MODEL_MAP


def get_display_name(model_name: str) -> str:
    standard_name = get_standard_model(model_name)
    return DISPLAY_NAMES.get(standard_name, standard_name)


def get_model_icon(model_name: str) -> str:
    standard_name = get_standard_model(model_name)
    return MODEL_ICONS.get(standard_name, "")
