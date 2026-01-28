# Page snapshot

```yaml
- generic [active] [ref=e1]:
    - generic [ref=e2]:
        - generic [ref=e3]:
            - button "Switch to Traditional Chinese" [ref=e4]: 繁
            - button "跟随系统" [ref=e5]:
                - img [ref=e6]
        - generic [ref=e9]:
            - heading "MoonTV" [level=1] [ref=e10]
            - generic [ref=e11]:
                - generic [ref=e12]:
                    - generic [ref=e13]: 用户名
                    - textbox "用户名" [ref=e14]:
                        - /placeholder: 输入用户名
                - generic [ref=e15]:
                    - generic [ref=e16]: 密码
                    - textbox "密码" [ref=e17]:
                        - /placeholder: 输入访问密码
                - button "登录" [disabled] [ref=e18]
        - button "Check for updates on GitHub" [ref=e19] [cursor=pointer]:
            - generic [ref=e20]: v100.0.3
            - generic [ref=e21]:
                - img [ref=e22]
                - generic [ref=e25]: 已是最新
    - alert [ref=e26]
```
